import axios from "axios";
import {
    SendType,
    ServerApiType,
    ServerFunctionDataType,
    ServerInfo,
} from "../mapi/server/type";
import { Files } from "../mapi/file/main";
import { Log } from "../mapi/log/main";

/**
 * DuixAvatarServer — wraps the two backing services that together form a
 * "local digital human":
 *
 *   fish-speech (default http://127.0.0.1:18180) — voice cloning
 *      POST /v1/preprocess_and_tran  — train / register a reference voice
 *      POST /v1/invoke               — synthesize new audio from cloned voice
 *
 *   Duix Heygem  (default http://127.0.0.1:8383) — talking-head video synthesis
 *      POST /easy/submit             — submit an (audio, silent-video) job
 *      GET  /easy/query?code=<code>  — poll for progress / result
 *
 * The training payload (silent video path + voice reference) is captured once
 * during "add server" (in ServerDuixAvatarAddDialog.vue) and stored in
 * `remoteConfig`. From then on soundClone / videoGen only need to hit
 * fish-speech `/v1/invoke` and Heygem `/easy/submit` + `/easy/query`.
 */

type RemoteCfg = {
    kind?: "duixAvatar";
    fishSpeechUrl?: string;
    heygemUrl?: string;
    voiceDataDir?: string;
    // Captured at "add server" time:
    referenceVideo?: string; // absolute local path
    silentVideo?: string; // absolute local path (audio-stripped)
    voiceReference?: {
        asr_format_audio_url: string;
        reference_audio_text: string;
    };
};

const FISH_SPEECH_DEFAULTS = {
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
};

const HEYGEM_POLL_INTERVAL_MS = 2000;
const HEYGEM_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export const DuixAvatarServer = function (config: any) {
    const me = this;

    this.serverConfig = {
        remoteConfig: (config?.config?.remoteConfig || {}) as RemoteCfg,
    };
    this.isRunning = false;
    this.ServerApi = null as ServerApiType | null;
    this.ServerInfo = null as ServerInfo | null;
    this.serverRuntime = {
        startTime: 0,
        currentHeygemCode: null as string | null,
        cancelled: false,
    };

    const cfg = (): RemoteCfg => this.serverConfig.remoteConfig || {};

    this.send = function (type: SendType, data: any) {
        if (!this.ServerApi || !this.ServerInfo) return;
        this.ServerApi.event.sendChannel(this.ServerInfo.eventChannelName, {
            type,
            data,
        });
    };

    this.init = async function () {};

    this.url = function () {
        return cfg().heygemUrl || "";
    };

    this.config = async function () {
        return {
            code: 0,
            msg: "ok",
            data: {
                httpUrl: cfg().heygemUrl || "",
                content: "Duix Avatar (fish-speech + Duix Heygem)",
                functions: {},
            },
        };
    };

    const pingFishSpeech = async () => {
        const url = cfg().fishSpeechUrl;
        if (!url) throw new Error("fishSpeechUrl not configured");
        // No dedicated health endpoint; a HEAD on root is enough to detect
        // that the service is reachable — we treat any HTTP response as up.
        try {
            await axios.get(url, { timeout: 5000, validateStatus: () => true });
            return true;
        } catch (e: any) {
            throw new Error(`fish-speech unreachable: ${e.message}`);
        }
    };

    const pingHeygem = async () => {
        const url = cfg().heygemUrl;
        if (!url) throw new Error("heygemUrl not configured");
        try {
            await axios.get(url, { timeout: 5000, validateStatus: () => true });
            return true;
        } catch (e: any) {
            throw new Error(`Duix Heygem unreachable: ${e.message}`);
        }
    };

    this.start = async function () {
        this.serverRuntime.startTime = Date.now();
        this.serverRuntime.cancelled = false;
        this.send("starting", this.ServerInfo);
        try {
            await pingFishSpeech();
            await pingHeygem();
            this.send("running", this.ServerInfo);
        } catch (e: any) {
            Log.error("DuixAvatarServer.start.error", e);
            this.send("error", this.ServerInfo);
            this.serverRuntime.startTime = 0;
        }
    };

    this.ping = async function (): Promise<boolean> {
        try {
            if (this.serverRuntime.startTime <= 0) return false;
            await pingFishSpeech();
            await pingHeygem();
            return true;
        } catch (e) {
            return false;
        }
    };

    this.stop = async function () {
        this.send("stopping", this.ServerInfo);
        this.serverRuntime.startTime = 0;
        this.send("stopped", this.ServerInfo);
        this.send("success", this.ServerInfo);
    };

    this.cancel = async function () {
        // Duix Heygem API does not expose a cancel endpoint; we just stop
        // polling and let the remote job finish/timeout on its own.
        this.serverRuntime.cancelled = true;
        this.serverRuntime.currentHeygemCode = null;
    };

    /**
     * soundClone — fish-speech /v1/invoke, using the reference captured at
     * add-server time.
     */
    this.soundClone = async function (
        data: ServerFunctionDataType,
    ): Promise<any> {
        return this._runSynthesize(data);
    };

    /**
     * soundTts is not natively supported (fish-speech needs a reference
     * voice), so we forward to the cloned voice.
     */
    this.soundTts = async function (
        data: ServerFunctionDataType,
    ): Promise<any> {
        return this._runSynthesize(data);
    };

    this._runSynthesize = async function (
        data: ServerFunctionDataType,
    ): Promise<any> {
        const result = { type: "success" as const, start: 0, end: 0, data: {} };
        if (this.isRunning) {
            return {
                code: 0,
                msg: "ok",
                data: { ...result, type: "retry" as const },
            };
        }
        this.isRunning = true;
        this.serverRuntime.cancelled = false;
        result.start = Date.now();
        try {
            this.send("taskRunning", { id: data.id });
            const audioPath = await synthesizeAudio(
                cfg(),
                (data.text as string) || "",
            );
            result.end = Date.now();
            result.data = { url: audioPath };
            return { code: 0, msg: "ok", data: result };
        } catch (e: any) {
            Log.error("DuixAvatarServer.soundClone.error", e);
            throw e?.message || String(e);
        } finally {
            this.isRunning = false;
        }
    };

    /**
     * videoGen — full talking-head synthesis:
     *   optional: fish-speech /v1/invoke to synthesize audio from `data.text`
     *             (if `data.audio` is not already provided)
     *   Duix Heygem /easy/submit + /easy/query
     *
     * Accepts either:
     *   - {text}    → clone audio first, then video
     *   - {audio}   → use provided audio directly
     *   - {video}   → override silent video from remoteConfig
     */
    this.videoGen = async function (
        data: ServerFunctionDataType,
    ): Promise<any> {
        const result = { type: "success" as const, start: 0, end: 0, data: {} };
        if (this.isRunning) {
            return {
                code: 0,
                msg: "ok",
                data: { ...result, type: "retry" as const },
            };
        }
        this.isRunning = true;
        this.serverRuntime.cancelled = false;
        result.start = Date.now();

        try {
            this.send("taskRunning", { id: data.id });

            // 1. Resolve audio: either use `data.audio`, or clone from text.
            let audioPath: string = data.audio as string;
            if (!audioPath && data.text) {
                audioPath = await synthesizeAudio(
                    cfg(),
                    data.text as string,
                );
            }
            if (!audioPath) {
                throw new Error(
                    "videoGen requires either `audio` or `text`",
                );
            }

            // 2. Resolve silent video (from data or from stored config).
            const silentVideo = (data.video as string) || cfg().silentVideo;
            if (!silentVideo) {
                throw new Error(
                    "Silent reference video not available; retrain the avatar",
                );
            }

            // 3. Submit to Heygem, poll for completion.
            const code = generateUuid();
            this.serverRuntime.currentHeygemCode = code;
            const videoLocalPath = await submitAndPollHeygem.call(
                this,
                cfg(),
                { audioPath, silentVideo, code },
                data.id,
            );

            result.end = Date.now();
            result.data = { url: videoLocalPath };
            return { code: 0, msg: "ok", data: result };
        } catch (e: any) {
            Log.error("DuixAvatarServer.videoGen.error", e);
            throw e?.message || String(e);
        } finally {
            this.isRunning = false;
            this.serverRuntime.currentHeygemCode = null;
        }
    };

    // ---- Shared helpers ----

    const generateUuid = (): string => {
        // RFC-4122 v4-ish; sufficient for a Heygem task code / speaker id.
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
            /[xy]/g,
            (c) => {
                const r = (Math.random() * 16) | 0;
                const v = c === "x" ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            },
        );
    };

    const synthesizeAudio = async (
        c: RemoteCfg,
        text: string,
    ): Promise<string> => {
        if (!c.fishSpeechUrl) throw new Error("fishSpeechUrl not configured");
        if (!c.voiceReference || !c.voiceReference.asr_format_audio_url) {
            throw new Error(
                "voiceReference missing; retrain the avatar first",
            );
        }
        if (!text) throw new Error("text is required for voice synthesis");
        const payload = {
            ...FISH_SPEECH_DEFAULTS,
            speaker: generateUuid(),
            text,
            // asr_format_audio_url is already a relative path (relative to
            // voiceDataDir) saved from training — fish-speech resolves it
            // inside its Docker volume.
            reference_audio: c.voiceReference.asr_format_audio_url,
            reference_text: c.voiceReference.reference_audio_text,
        };
        const res = await axios.post(
            `${trimTrailingSlash(c.fishSpeechUrl)}/v1/invoke`,
            payload,
            {
                responseType: "arraybuffer",
                timeout: 5 * 60 * 1000,
            },
        );
        const buffer = Buffer.from(res.data);
        const outPath = await Files.temp("wav", "duixAvatar_audio");
        const fs = await import("fs");
        fs.writeFileSync(outPath, buffer);
        return outPath;
    };

    async function submitAndPollHeygem(
        this: any,
        c: RemoteCfg,
        params: { audioPath: string; silentVideo: string; code: string },
        taskId: string,
    ): Promise<string> {
        if (!c.heygemUrl) throw new Error("heygemUrl not configured");
        const base = trimTrailingSlash(c.heygemUrl);

        const submitRes = await axios.post(`${base}/easy/submit`, {
            audio_url: params.audioPath,
            video_url: params.silentVideo,
            code: params.code,
            chaofen: 0,
            watermark_switch: 0,
            pn: 1,
        });
        if (submitRes.data && submitRes.data.code && submitRes.data.code !== 0
            && submitRes.data.code !== 10000) {
            throw new Error(
                submitRes.data.msg || "Duix Heygem submit failed",
            );
        }

        const started = Date.now();
        while (true) {
            if (this.serverRuntime.cancelled) {
                throw new Error("Cancelled");
            }
            if (Date.now() - started > HEYGEM_TIMEOUT_MS) {
                throw new Error("Video synthesis timed out");
            }
            await this.ServerApi.sleep(HEYGEM_POLL_INTERVAL_MS);
            let queryRes: any;
            try {
                queryRes = await axios.get(
                    `${base}/easy/query?code=${encodeURIComponent(params.code)}`,
                );
            } catch (e: any) {
                Log.error("DuixAvatarServer.query.error", e);
                continue;
            }
            const body = queryRes.data || {};
            const data = body.data || body;

            // Heygem returns { status: number | string, progress, result }.
            // Observed values:
            //   1  / "1"     running
            //   2  / "2"     succeeded
            //   3  / "3"     failed
            const status = data.status ?? data.state;
            const progress = data.progress;
            if (typeof progress === "number") {
                this.send("taskStatus", {
                    id: taskId,
                    result: { progress },
                });
            }
            const statusStr = String(status ?? "");
            if (statusStr === "2" || statusStr === "success"
                || statusStr === "succeed") {
                const resultUrl: string | undefined = data.result || data.url
                    || data.video_url;
                if (!resultUrl) {
                    throw new Error(
                        "Heygem succeeded but no result URL returned",
                    );
                }
                return await resolveResultToLocal(base, resultUrl);
            }
            if (statusStr === "3" || statusStr === "error"
                || statusStr === "fail" || statusStr === "failed") {
                throw new Error(
                    data.msg || body.msg || "Video synthesis failed",
                );
            }
            // else keep polling
        }
    }

    const resolveResultToLocal = async (
        base: string,
        resultUrl: string,
    ): Promise<string> => {
        // If the URL is already a filesystem path we've been handed, keep it.
        if (
            /^[a-zA-Z]:[\\/]/.test(resultUrl) ||
            resultUrl.startsWith("/") && !resultUrl.startsWith("//")
        ) {
            if (await Files.exists(resultUrl, { isDataPath: false })) {
                return resultUrl;
            }
        }
        // Otherwise treat as HTTP URL relative to Heygem base.
        const full = /^https?:\/\//i.test(resultUrl)
            ? resultUrl
            : `${base}/${resultUrl.replace(/^\//, "")}`;
        const ext = Files.ext(full) || "mp4";
        const localPath = await Files.temp(ext, "duixAvatar_video");
        await Files.download(full, localPath, { isDataPath: false });
        return localPath;
    };

    const trimTrailingSlash = (u: string) =>
        u.endsWith("/") ? u.substring(0, u.length - 1) : u;
};

export default DuixAvatarServer;
