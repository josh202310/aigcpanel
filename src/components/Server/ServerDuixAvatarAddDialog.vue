<script setup lang="ts">
import axios from "axios";
import { computed, onMounted, ref, watch } from "vue";
import { t } from "../../lang";
import { Dialog } from "../../lib/dialog";
import { StringUtil } from "../../lib/util";
import { FileUtil } from "../../lib/file";
import { useServerStore } from "../../store/modules/server";
import { EnumServerType, ServerRecord } from "../../types/Server";
import FileSelector from "../common/FileSelector.vue";

/**
 * Dialog for adding a full-pipeline local Duix Avatar server.
 *
 * Backend contract (see electron/aigcserver/DuixAvatarServer.ts):
 *   fish-speech @ POST /v1/preprocess_and_tran + POST /v1/invoke
 *   Duix Heygem @ POST /easy/submit + GET /easy/query?code=
 *
 * The dialog walks the user through three tests. Only after all three pass
 * can they confirm-add, at which point the trained voice reference and the
 * generated silent-video path are captured into the server record's
 * `remoteConfig` so downstream soundClone / videoGen calls can be made
 * without repeating the training step.
 */

const DEFAULTS = {
    fishSpeechUrl: "http://127.0.0.1:18180",
    heygemUrl: "http://127.0.0.1:8383",
    voiceDataDir: "D:\\duix_avatar_data\\voice\\data",
};

const CONFIG_KEYS = {
    fishSpeechUrl: "duixAvatarFishSpeechUrl",
    heygemUrl: "duixAvatarHeygemUrl",
    voiceDataDir: "duixAvatarVoiceDataDir",
};

const serverStore = useServerStore();

const visible = ref(false);
const loading = ref(false); // final "add server" button
const serverTitle = ref("");
const fishSpeechUrl = ref(DEFAULTS.fishSpeechUrl);
const heygemUrl = ref(DEFAULTS.heygemUrl);
const voiceDataDir = ref(DEFAULTS.voiceDataDir);
const referenceVideo = ref("");
const testText = ref("");

type StepState = {
    status: "pending" | "running" | "done" | "failed";
    message: string;
};
const step1 = ref<StepState>({ status: "pending", message: "" });
const step2 = ref<StepState>({ status: "pending", message: "" });
const step3 = ref<StepState>({ status: "pending", message: "" });

// Artifacts captured across the three steps
const silentVideoPath = ref(""); // absolute local path
const trainingResult = ref<{
    asr_format_audio_url: string;
    reference_audio_text: string;
} | null>(null);
const testAudioPath = ref(""); // absolute local path (fish-speech synthesized)
const testVideoPath = ref(""); // absolute local path (Heygem synthesized)
const heygemPollingCode = ref("");

const allStepsDone = computed(
    () =>
        step1.value.status === "done" &&
        step2.value.status === "done" &&
        step3.value.status === "done",
);

const resetAllSteps = () => {
    step1.value = { status: "pending", message: "" };
    step2.value = { status: "pending", message: "" };
    step3.value = { status: "pending", message: "" };
    silentVideoPath.value = "";
    trainingResult.value = null;
    testAudioPath.value = "";
    testVideoPath.value = "";
    heygemPollingCode.value = "";
};

const loadDefaults = async () => {
    try {
        fishSpeechUrl.value =
            (await $mapi.config.get(CONFIG_KEYS.fishSpeechUrl, "")) ||
            DEFAULTS.fishSpeechUrl;
        heygemUrl.value =
            (await $mapi.config.get(CONFIG_KEYS.heygemUrl, "")) ||
            DEFAULTS.heygemUrl;
        voiceDataDir.value =
            (await $mapi.config.get(CONFIG_KEYS.voiceDataDir, "")) ||
            DEFAULTS.voiceDataDir;
    } catch (e) {
        // fall through to defaults
    }
};

onMounted(loadDefaults);

const show = () => {
    visible.value = true;
    loading.value = false;
    serverTitle.value = t("duixAvatar.serverTitleDefault");
    testText.value = t("duixAvatar.testTextDefault");
    referenceVideo.value = "";
    resetAllSteps();
    loadDefaults();
};

// If the user changes any input that could invalidate prior tests, reset from
// that step forward.
watch(
    [fishSpeechUrl, heygemUrl, voiceDataDir, referenceVideo],
    () => resetAllSteps(),
);
watch(testText, () => {
    // Text only affects step 2 & 3
    if (step2.value.status !== "pending" || step3.value.status !== "pending") {
        step2.value = { status: "pending", message: "" };
        step3.value = { status: "pending", message: "" };
        testAudioPath.value = "";
        testVideoPath.value = "";
    }
});

const resetDefaults = () => {
    fishSpeechUrl.value = DEFAULTS.fishSpeechUrl;
    heygemUrl.value = DEFAULTS.heygemUrl;
    voiceDataDir.value = DEFAULTS.voiceDataDir;
};

const trimSlash = (u: string) =>
    u.endsWith("/") ? u.substring(0, u.length - 1) : u;

// --- Step 1: train the avatar ---------------------------------------------
const runStep1 = async () => {
    if (!referenceVideo.value) {
        Dialog.tipError(t("error.referenceVideoRequired"));
        return;
    }
    if (!voiceDataDir.value) {
        Dialog.tipError(t("error.voiceDataDirRequired"));
        return;
    }
    step1.value = { status: "running", message: "" };
    // subsequent steps get invalidated
    step2.value = { status: "pending", message: "" };
    step3.value = { status: "pending", message: "" };
    testAudioPath.value = "";
    testVideoPath.value = "";

    try {
        // 1a. Extract audio from reference video.
        //     fish-speech expects a wav file; we use ffmpeg to output .wav
        //     directly rather than .mp3 → fish-speech might reject non-wav.
        const wavTmp = await $mapi.file.temp("wav", "duixAvatar_audio");
        await $mapi.app.spawnBinary("ffmpeg", [
            "-y",
            "-i",
            referenceVideo.value,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            wavTmp,
        ]);
        if (!(await $mapi.file.exists(wavTmp))) {
            throw new Error("Failed to extract audio from reference video");
        }

        // 1b. Copy that audio into the fish-speech-mounted directory using a
        //     unique subdirectory so multiple avatars don't collide.
        //     IMPORTANT: fish-speech runs inside Docker, so it can only see
        //     paths *inside* its volume mount.  We write directly into
        //     voiceDataDir (which should be the Docker mount point, e.g.
        //     D:\duix_avatar_data\voice\data), and we pass the *same*
        //     absolute path to fish-speech — it must be accessible from within
        //     the container.
        const runId = StringUtil.random(12);
        const audioBaseName = `${runId}.wav`;
        const sep = voiceDataDir.value.includes("\\") ? "\\" : "/";
        const trainedAudioDir =
            trimTrailingPathSep(voiceDataDir.value) + sep + runId;
        const trainedAudioPath = trainedAudioDir + sep + audioBaseName;

        // Ensure the subdirectory exists (Docker volume mounts won't auto-create)
        await $mapi.file.mkdir(trainedAudioDir, { isDataPath: false });
        await $mapi.file.copy(wavTmp, trainedAudioPath, {
            overwrite: true,
            isDataPath: false,
        });

        // Verify the file actually exists on disk before calling fish-speech
        const exists = await $mapi.file.exists(trainedAudioPath, { isDataPath: false });
        if (!exists) {
            throw new Error(
                `Audio file not found after copy: ${trainedAudioPath}`,
            );
        }
        console.log(
            "[DuixAvatar] trained audio path:",
            trainedAudioPath,
        );

        // 1c. Produce a silent copy of the reference video (stripped audio).
        //     This is the video handed to Heygem later; kept locally under
        //     the app's temp folder.
        const silentPath = await $mapi.file.temp("mp4", "duixAvatar_silent");
        await $mapi.app.spawnBinary("ffmpeg", [
            "-y",
            "-i",
            referenceVideo.value,
            "-an",
            "-c:v",
            "copy",
            silentPath,
        ]);
        if (!(await $mapi.file.exists(silentPath))) {
            throw new Error("Failed to generate silent video");
        }
        silentVideoPath.value = silentPath;

        // Compute relative path from voiceDataDir — fish-speech runs inside
        // Docker, so absolute Windows paths won't resolve inside the container.
        // The Docker volume mount maps voiceDataDir → its own root (or
        // voiceDataDir inside the container), so a relative path works in both.
        const voiceDataDirTrimmed = trimTrailingPathSep(voiceDataDir.value);
        const relativeAudioPath = trainedAudioPath.substring(
            voiceDataDirTrimmed.length + 1,
        ); // strip leading dir + separator

        // 1d. Call fish-speech to register the voice reference.
        //     fish-speech preprocess_and_tran expects: { reference_audio, lang }
        //     (guiji2025/fish-speech-ziming variant; NOT audio_url)
        console.log(
            "[DuixAvatar] preprocess_and_tran payload:",
            JSON.stringify({
                reference_audio: relativeAudioPath,
                lang: "zh",
            }),
        );
        let res;
        try {
            res = await axios.post(
                `${trimSlash(fishSpeechUrl.value)}/v1/preprocess_and_tran`,
                {
                    reference_audio: relativeAudioPath,
                    lang: "zh",
                },
                {
                    timeout: 5 * 60 * 1000,
                    headers: { "Content-Type": "application/json" },
                },
            );
        } catch (e: any) {
            console.error("[DuixAvatar] preprocess_and_tran HTTP error:", e?.response?.data || e.message);
            throw new Error(
                (e?.response?.data?.msg || e?.response?.data?.detail || e?.response?.data?.message || e?.message) as string,
            );
        }
        const data = res.data || {};
        console.log("[DuixAvatar] preprocess_and_tran raw response:", JSON.stringify(data, null, 2));
        if (!data.asr_format_audio_url || !data.reference_audio_text) {
            throw new Error(
                data.msg ||
                    "fish-speech returned no reference_audio_text / asr_format_audio_url",
            );
        }
        trainingResult.value = {
            asr_format_audio_url: data.asr_format_audio_url,
            reference_audio_text: data.reference_audio_text,
        };
        step1.value = { status: "done", message: "" };
    } catch (e: any) {
        console.error("DuixAvatar.step1.error", e);
        step1.value = {
            status: "failed",
            message: e?.message || String(e),
        };
    }
};

const trimTrailingPathSep = (p: string) => {
    if (p.endsWith("\\") || p.endsWith("/")) {
        return p.substring(0, p.length - 1);
    }
    return p;
};

// --- Step 2: synthesize audio ---------------------------------------------
const runStep2 = async () => {
    if (step1.value.status !== "done" || !trainingResult.value) {
        Dialog.tipError(t("error.trainingFailed"));
        return;
    }
    if (!testText.value) {
        Dialog.tipError(t("error.testTextRequired"));
        return;
    }
    step2.value = { status: "running", message: "" };
    step3.value = { status: "pending", message: "" };
    testVideoPath.value = "";
    try {
        const res = await axios.post(
            `${trimSlash(fishSpeechUrl.value)}/v1/invoke`,
            {
                speaker: StringUtil.uuid(),
                text: testText.value,
                format: "wav",
                topP: 0.7,
                max_new_tokens: 1024,
                chunk_length: 100,
                repetition_penalty: 1.2,
                temperature: 0.7,
                need_asr: false,
                streaming: false,
                is_fixed_seed: 0,
                is_norm: 0,
                reference_audio: trainingResult.value.asr_format_audio_url,
                reference_text: trainingResult.value.reference_audio_text,
            },
            {
                responseType: "arraybuffer",
                timeout: 5 * 60 * 1000,
            },
        );
        // Persist to a temp .wav for preview / step 3.
        const outPath = await $mapi.file.temp("wav", "duixAvatar_audio");
        // arraybuffer → Uint8Array → base64 → writeBuffer via writeString
        // $mapi.file has no direct binary writer in renderer? Fall back to
        // writing via `writeBuffer` if available; otherwise use fetch+blob.
        const bytes = new Uint8Array(res.data);
        await $mapi.file.writeBuffer(outPath, bytes, { isDataPath: false });
        testAudioPath.value = outPath;
        step2.value = { status: "done", message: "" };
    } catch (e: any) {
        console.error("DuixAvatar.step2.error", e);
        step2.value = {
            status: "failed",
            message: e?.message || String(e),
        };
    }
};

// --- Step 3: synthesize video ---------------------------------------------
const runStep3 = async () => {
    if (step2.value.status !== "done" || !testAudioPath.value) {
        Dialog.tipError(t("error.ttsFailed"));
        return;
    }
    if (!silentVideoPath.value) {
        Dialog.tipError(t("error.referenceVideoRequired"));
        return;
    }
    step3.value = { status: "running", message: "" };
    testVideoPath.value = "";
    const code = StringUtil.uuid();
    heygemPollingCode.value = code;
    try {
        const base = trimSlash(heygemUrl.value);
        const submitRes = await axios.post(`${base}/easy/submit`, {
            audio_url: testAudioPath.value,
            video_url: silentVideoPath.value,
            code,
            chaofen: 0,
            watermark_switch: 0,
            pn: 1,
        });
        const submitData = submitRes.data || {};
        if (
            submitData.code !== undefined &&
            submitData.code !== 0 &&
            submitData.code !== 10000
        ) {
            throw new Error(submitData.msg || "Duix Heygem submit failed");
        }

        const started = Date.now();
        const timeout = 30 * 60 * 1000; // 30 minutes
        while (true) {
            if (heygemPollingCode.value !== code) {
                throw new Error("Cancelled");
            }
            if (Date.now() - started > timeout) {
                throw new Error(t("error.videoTaskTimeout"));
            }
            await new Promise((r) => setTimeout(r, 2000));
            let queryRes: any;
            try {
                queryRes = await axios.get(
                    `${base}/easy/query?code=${encodeURIComponent(code)}`,
                );
            } catch (e) {
                // transient — keep polling
                continue;
            }
            const body = queryRes.data || {};
            const data = body.data || body;
            const statusStr = String(data.status ?? data.state ?? "");
            if (typeof data.progress === "number") {
                step3.value = {
                    status: "running",
                    message: `${data.progress}%`,
                };
            }
            if (
                statusStr === "2" ||
                statusStr === "success" ||
                statusStr === "succeed"
            ) {
                const resultUrl: string | undefined =
                    data.result || data.url || data.video_url;
                if (!resultUrl) {
                    throw new Error("No result URL from Duix Heygem");
                }
                testVideoPath.value = resultUrl;
                step3.value = { status: "done", message: "" };
                return;
            }
            if (
                statusStr === "3" ||
                statusStr === "error" ||
                statusStr === "fail" ||
                statusStr === "failed"
            ) {
                throw new Error(
                    data.msg || body.msg || t("error.videoSynthesisFailed"),
                );
            }
        }
    } catch (e: any) {
        console.error("DuixAvatar.step3.error", e);
        step3.value = {
            status: "failed",
            message: e?.message || String(e),
        };
    } finally {
        heygemPollingCode.value = "";
    }
};

const cancelStep3 = () => {
    heygemPollingCode.value = "";
    step3.value = { status: "pending", message: "" };
};

// --- Confirm: add server --------------------------------------------------
const doAdd = async () => {
    if (!allStepsDone.value) return;
    loading.value = true;
    try {
        // Persist URLs for next time.
        await $mapi.config.set(
            CONFIG_KEYS.fishSpeechUrl,
            fishSpeechUrl.value,
        );
        await $mapi.config.set(CONFIG_KEYS.heygemUrl, heygemUrl.value);
        await $mapi.config.set(CONFIG_KEYS.voiceDataDir, voiceDataDir.value);

        const name = "duix-avatar";
        const version = "1.0.0";
        // Allow multiple Duix avatars — namespace by a random tag in the key.
        const tag = StringUtil.random(8);
        const record: ServerRecord = {
            key: serverStore.generateServerKey({
                name: `${name}-${tag}`,
                version,
            } as any),
            localPath: `${name}_${tag}_${StringUtil.random(8)}`,
            name: `${name}-${tag}`,
            title: serverTitle.value || t("duixAvatar.serverTitleDefault"),
            version,
            type: EnumServerType.REMOTE,
            autoStart: true,
            functions: ["soundClone", "videoGen"],
            remoteConfig: {
                kind: "duixAvatar",
                fishSpeechUrl: trimSlash(fishSpeechUrl.value),
                heygemUrl: trimSlash(heygemUrl.value),
                voiceDataDir: voiceDataDir.value,
                referenceVideo: referenceVideo.value,
                silentVideo: silentVideoPath.value,
                voiceReference: trainingResult.value,
            } as any,
            settings: [],
            setting: {},
            config: {},
        };
        await serverStore.add(record);
        Dialog.tipSuccess(t("model.addSuccess"));
        visible.value = false;
        emit("update");
    } catch (e: any) {
        console.error("DuixAvatar.doAdd.error", e);
        Dialog.tipError(e?.message || "Failed to add server");
    } finally {
        loading.value = false;
    }
};

defineExpose({ show });

const emit = defineEmits({
    update: () => true,
});

const statusIcon = (s: StepState["status"]) => {
    switch (s) {
        case "done":
            return "✓";
        case "failed":
            return "✗";
        case "running":
            return "…";
        default:
            return "○";
    }
};
const statusColor = (s: StepState["status"]) => {
    switch (s) {
        case "done":
            return "text-green-600";
        case "failed":
            return "text-red-600";
        case "running":
            return "text-blue-600";
        default:
            return "text-gray-400";
    }
};
const statusLabel = (s: StepState["status"]) => {
    switch (s) {
        case "done":
            return t("duixAvatar.stepDone");
        case "failed":
            return t("duixAvatar.stepFailed");
        case "running":
            return t("duixAvatar.stepRunning");
        default:
            return t("duixAvatar.stepPending");
    }
};
</script>

<template>
    <a-modal
        v-model:visible="visible"
        width="46rem"
        :footer="false"
        :esc-to-close="false"
        :mask-closable="false"
        title-align="start"
    >
        <template #title>
            {{ $t("duixAvatar.title") }}
        </template>
        <div class="p-2">
            <div class="mb-4 text-sm text-gray-500">
                {{ $t("duixAvatar.description") }}
            </div>

            <!-- Endpoints -->
            <div class="mb-4">
                <div class="mb-2 text-gray-700">
                    {{ $t("duixAvatar.serverTitle") }}
                </div>
                <a-input v-model="serverTitle" allow-clear />
            </div>
            <div class="mb-4">
                <div class="mb-2 text-gray-700">
                    {{ $t("duixAvatar.fishSpeechUrl") }}
                </div>
                <a-input
                    v-model="fishSpeechUrl"
                    :placeholder="$t('duixAvatar.fishSpeechUrlPlaceholder')"
                    allow-clear
                />
            </div>
            <div class="mb-4">
                <div class="mb-2 text-gray-700">
                    {{ $t("duixAvatar.heygemUrl") }}
                </div>
                <a-input
                    v-model="heygemUrl"
                    :placeholder="$t('duixAvatar.heygemUrlPlaceholder')"
                    allow-clear
                />
            </div>
            <div class="mb-4">
                <div class="mb-2 text-gray-700">
                    {{ $t("duixAvatar.voiceDataDir") }}
                </div>
                <a-input v-model="voiceDataDir" allow-clear />
                <div class="mt-1 text-xs text-gray-400">
                    {{ $t("duixAvatar.voiceDataDirTip") }}
                </div>
            </div>
            <div class="mb-4">
                <a-button size="small" @click="resetDefaults">
                    {{ $t("duixAvatar.resetDefaults") }}
                </a-button>
            </div>

            <!-- Reference video + test text -->
            <div class="mb-4">
                <div class="mb-2 text-gray-700">
                    {{ $t("duixAvatar.selectReferenceVideo") }}
                </div>
                <FileSelector
                    v-model="referenceVideo"
                    :extensions="['mp4', 'mov', 'mkv']"
                />
                <div class="mt-1 text-xs text-gray-400">
                    {{ $t("duixAvatar.selectReferenceVideoTip") }}
                </div>
            </div>
            <div class="mb-4">
                <div class="mb-2 text-gray-700">
                    {{ $t("duixAvatar.testText") }}
                </div>
                <a-textarea
                    v-model="testText"
                    :placeholder="$t('duixAvatar.testTextPlaceholder')"
                    :auto-size="{ minRows: 2, maxRows: 4 }"
                />
            </div>

            <!-- Step panels -->
            <div class="border border-gray-200 rounded-lg mb-4">
                <div
                    v-for="(step, idx) in [
                        {
                            state: step1,
                            titleKey: 'duixAvatar.step1',
                            descKey: 'duixAvatar.step1Desc',
                            run: runStep1,
                            enabled: !!referenceVideo,
                        },
                        {
                            state: step2,
                            titleKey: 'duixAvatar.step2',
                            descKey: 'duixAvatar.step2Desc',
                            run: runStep2,
                            enabled: step1.status === 'done',
                        },
                        {
                            state: step3,
                            titleKey: 'duixAvatar.step3',
                            descKey: 'duixAvatar.step3Desc',
                            run: runStep3,
                            enabled: step2.status === 'done',
                        },
                    ]"
                    :key="idx"
                    class="p-3"
                    :class="idx > 0 ? 'border-t border-gray-200' : ''"
                >
                    <div class="flex items-center">
                        <div
                            class="w-6 text-center font-bold"
                            :class="statusColor(step.state.status)"
                        >
                            {{ statusIcon(step.state.status) }}
                        </div>
                        <div class="flex-grow ml-2">
                            <div class="font-medium">
                                {{ $t(step.titleKey) }}
                            </div>
                            <div class="text-xs text-gray-500">
                                {{ $t(step.descKey) }}
                            </div>
                        </div>
                        <div
                            class="text-xs mr-2"
                            :class="statusColor(step.state.status)"
                        >
                            {{ statusLabel(step.state.status) }}
                        </div>
                        <a-button
                            v-if="
                                step.state.status !== 'running' &&
                                step.state.status !== 'done'
                            "
                            size="small"
                            :disabled="!step.enabled"
                            @click="step.run"
                        >
                            {{ $t("duixAvatar.runStep") }}
                        </a-button>
                        <a-button
                            v-else-if="
                                step.state.status === 'running' &&
                                idx === 2
                            "
                            size="small"
                            status="danger"
                            @click="cancelStep3"
                        >
                            {{ $t("common.cancel") }}
                        </a-button>
                        <a-button
                            v-else-if="step.state.status === 'running'"
                            size="small"
                            loading
                            disabled
                        >
                            {{ $t("duixAvatar.stepRunning") }}
                        </a-button>
                        <a-button
                            v-else-if="step.state.status === 'done'"
                            size="small"
                            @click="step.run"
                        >
                            {{ $t("duixAvatar.runStep") }}
                        </a-button>
                    </div>
                    <div
                        v-if="step.state.status === 'failed'"
                        class="mt-2 text-xs text-red-600 break-words"
                    >
                        {{ step.state.message }}
                    </div>
                    <div
                        v-if="idx === 0 && trainingResult"
                        class="mt-2 text-xs text-gray-600 bg-gray-50 rounded p-2 break-all"
                    >
                        <div>
                            <span class="text-gray-400">{{
                                $t("duixAvatar.trainedAudioText")
                            }}</span
                            >:
                            {{ trainingResult.reference_audio_text }}
                        </div>
                    </div>
                    <div v-if="idx === 1 && testAudioPath" class="mt-2">
                        <div class="text-xs text-gray-400 mb-1">
                            {{ $t("duixAvatar.previewAudio") }}
                        </div>
                        <audio
                            controls
                            :src="`file://${testAudioPath}`"
                            class="w-full"
                        />
                    </div>
                    <div v-if="idx === 2 && testVideoPath" class="mt-2">
                        <div class="text-xs text-gray-400 mb-1">
                            {{ $t("duixAvatar.previewVideo") }}
                        </div>
                        <div class="text-xs text-gray-600 break-all">
                            {{ testVideoPath }}
                        </div>
                    </div>
                </div>
            </div>

            <div
                v-if="allStepsDone"
                class="mb-4 p-2 bg-green-50 text-green-700 text-sm rounded"
            >
                {{ $t("duixAvatar.readyToAdd") }}
            </div>

            <div class="flex justify-end gap-2 mt-2">
                <a-button @click="visible = false" :disabled="loading">
                    {{ $t("common.cancel") }}
                </a-button>
                <a-button
                    type="primary"
                    :disabled="!allStepsDone"
                    :loading="loading"
                    @click="doAdd"
                >
                    {{ $t("duixAvatar.addServer") }}
                </a-button>
            </div>
        </div>
    </a-modal>
</template>
