<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import Router from "../router";
import PageHeader from "../components/PageHeader.vue";
import { useLiveStore } from "../store/modules/live";
import { StorageService } from "../service/StorageService";

const liveStore = useLiveStore();

const tab = ref("");

const syncTab = () => {
    tab.value = (Router.currentRoute.value.query.tab as string) || "monitor";
};

onMounted(() => {
    syncTab();
});

watch(() => Router.currentRoute.value.query.tab, syncTab);

// Monitor tab
const monitorUrl = ref(liveStore.localConfig.config.liveMonitorUrl || "");
const monitorType = ref(liveStore.localConfig.config.liveMonitorType || "douyin");
const isMonitoring = ref(false);

const saveMonitorConfig = async () => {
    liveStore.localConfig.config.liveMonitorUrl = monitorUrl.value;
    liveStore.localConfig.config.liveMonitorType = monitorType.value;
    await liveStore.saveLocalConfig();
};

const startMonitor = async () => {
    await liveStore.startMonitor();
    isMonitoring.value = true;
};

const stopMonitor = async () => {
    await liveStore.stopMonitor();
    isMonitoring.value = false;
};

// Avatar tab
const avatarModels = [
    { value: "wav2lip", title: "wav2lip (Standard)" },
    { value: "wav2lip384", title: "wav2lip384 (HQ)" },
];
const currentAvatarModel = ref(liveStore.localConfig.model);
const avatarWidth = ref(liveStore.localConfig.avatar.width);
const avatarHeight = ref(liveStore.localConfig.avatar.height);
const avatarId = ref(liveStore.localConfig.avatar.avatarId);

const saveAvatarConfig = async () => {
    liveStore.localConfig.model = currentAvatarModel.value;
    liveStore.localConfig.avatar.width = avatarWidth.value;
    liveStore.localConfig.avatar.height = avatarHeight.value;
    liveStore.localConfig.avatar.avatarId = avatarId.value;
    await liveStore.saveLocalConfig();
};

// Knowledge tab
const knowledgeRecords = ref<any[]>([]);
const knowledgeBizTypes = ["flowVideo", "flowTalk", "user", "system"] as const;
const activeKnowledgeBiz = ref("flowVideo");

const loadKnowledge = async () => {
    const bizMap: Record<string, "LiveKnowledge"> = {
        flowVideo: "LiveKnowledge",
        flowTalk: "LiveKnowledge",
        user: "LiveKnowledge",
        system: "LiveKnowledge",
    };
    const records = await StorageService.list("LiveKnowledge");
    knowledgeRecords.value = records.filter(
        (r) => r.content.type === activeKnowledgeBiz.value,
    );
};

const saveKnowledge = async () => {
    await liveStore.update();
};

// Event tab
const eventDefaultUsername = ref(liveStore.localConfig.config.eventDefaultUsername || "宝子");
const eventEnterIgnoreSecond = ref(liveStore.localConfig.config.eventEnterIgnoreSecond || 120);

const saveEventConfig = async () => {
    liveStore.localConfig.config.eventDefaultUsername = eventDefaultUsername.value;
    liveStore.localConfig.config.eventEnterIgnoreSecond = eventEnterIgnoreSecond.value;
    await liveStore.saveLocalConfig();
};

// Talk history tab
const talkHistoryRecords = ref<any[]>([]);

const loadTalkHistory = async () => {
    const records = await StorageService.list("LiveTalk");
    talkHistoryRecords.value = records;
};

// Service tab
const isRunning = ref(liveStore.status === "running");
const serviceStatus = ref(liveStore.status);

const startService = async () => {
    try {
        await liveStore.start();
        isRunning.value = true;
    } catch {
        // handled by store
    }
};

const stopService = async () => {
    try {
        await liveStore.stop();
        isRunning.value = false;
    } catch {
        // handled by store
    }
};

const refreshStatus = () => {
    serviceStatus.value = liveStore.status;
    isRunning.value = liveStore.status === "running";
};

// Auto-refresh status
setInterval(refreshStatus, 5000);

// Load data on tab change
watch(tab, (newTab) => {
    if (newTab === "knowledge") loadKnowledge();
    if (newTab === "talkHistory") loadTalkHistory();
});
</script>

<template>
    <div class="pb-device-container bg-white h-full relative select-none flex">
        <div
            class="p-6 w-52 flex-shrink-0 border-r border-solid border-gray-100 overflow-x-hidden overflow-y-auto"
        >
            <div
                class="p-2 rounded-lg mb-4 cursor-pointer"
                :class="tab === 'monitor' ? 'bg-gray-200' : ''"
                @click="tab = 'monitor'"
            >
                <div class="text-base flex items-center">
                    <i-mdi-broadcast class="w-5 h-5 inline-block mr-1 text-rose-500" />
                    {{ $t("live.service") }}
                </div>
            </div>
            <div
                class="p-2 rounded-lg mb-4 cursor-pointer"
                :class="tab === 'avatar' ? 'bg-gray-200' : ''"
                @click="tab = 'avatar'"
            >
                <div class="text-base flex items-center">
                    <i-mdi-account-circle class="w-5 h-5 inline-block mr-1 text-blue-500" />
                    {{ $t("live.avatar") }}
                </div>
            </div>
            <div
                class="p-2 rounded-lg mb-4 cursor-pointer"
                :class="tab === 'knowledge' ? 'bg-gray-200' : ''"
                @click="tab = 'knowledge'"
            >
                <div class="text-base flex items-center">
                    <i-mdi-book-open-variant class="w-5 h-5 inline-block mr-1 text-amber-500" />
                    {{ $t("live.knowledge") }}
                </div>
            </div>
            <div
                class="p-2 rounded-lg mb-4 cursor-pointer"
                :class="tab === 'event' ? 'bg-gray-200' : ''"
                @click="tab = 'event'"
            >
                <div class="text-base flex items-center">
                    <i-mdi-chat class="w-5 h-5 inline-block mr-1 text-emerald-500" />
                    {{ $t("live.event") }}
                </div>
            </div>
            <div
                class="p-2 rounded-lg mb-4 cursor-pointer"
                :class="tab === 'liveTalk' ? 'bg-gray-200' : ''"
                @click="tab = 'liveTalk'"
            >
                <div class="text-base flex items-center">
                    <i-mdi-history class="w-5 h-5 inline-block mr-1 text-violet-500" />
                    {{ $t("live.talkHistory") }}
                </div>
            </div>
        </div>
        <div class="flex-grow h-full overflow-y-auto">
            <div class="p-6">
                <PageHeader :title="$t('live.title')" />
                <div style="height: calc(100vh - 10rem)">
                    <!-- Monitor Tab -->
                    <div v-if="tab === 'monitor'" class="space-y-4">
                        <div class="bg-gray-50 p-4 rounded-lg">
                            <h4 class="font-semibold mb-3">直播间监控</h4>
                            <div class="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label class="block text-sm text-gray-600 mb-1">监控类型</label>
                                    <select v-model="monitorType" class="w-full p-2 border rounded" @change="saveMonitorConfig">
                                        <option value="douyin">抖音</option>
                                        <option value="kuaishou">快手</option>
                                        <option value="bilibili">B站</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-sm text-gray-600 mb-1">直播间地址</label>
                                    <input v-model="monitorUrl" class="w-full p-2 border rounded" placeholder="输入直播间URL" @change="saveMonitorConfig" />
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <a-button type="primary" @click="startMonitor" :disabled="isMonitoring">
                                    <icon-play-circle /> 开始监控
                                </a-button>
                                <a-button @click="stopMonitor" :disabled="!isMonitoring">
                                    <icon-stop /> 停止监控
                                </a-button>
                            </div>
                        </div>
                        <div class="bg-gray-50 p-4 rounded-lg">
                            <h4 class="font-semibold mb-3">当前状态</h4>
                            <div class="flex items-center gap-2">
                                <span class="text-gray-600">状态:</span>
                                <a-tag :color="serviceStatus === 'running' ? 'green' : 'red'">
                                    {{ serviceStatus }}
                                </a-tag>
                            </div>
                        </div>
                    </div>

                    <!-- Avatar Tab -->
                    <div v-if="tab === 'avatar'" class="space-y-4">
                        <div class="bg-gray-50 p-4 rounded-lg">
                            <h4 class="font-semibold mb-3">直播形象设置</h4>
                            <div class="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label class="block text-sm text-gray-600 mb-1">模型</label>
                                    <select v-model="currentAvatarModel" class="w-full p-2 border rounded" @change="saveAvatarConfig">
                                        <option v-for="m in avatarModels" :key="m.value" :value="m.value">
                                            {{ m.title }}
                                        </option>
                                    </select>
                                </div>
                                <div>
                                    <label class="block text-sm text-gray-600 mb-1">形象ID</label>
                                    <input v-model.number="avatarId" type="number" class="w-full p-2 border rounded" @change="saveAvatarConfig" />
                                </div>
                            </div>
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-sm text-gray-600 mb-1">宽度</label>
                                    <input v-model.number="avatarWidth" type="number" class="w-full p-2 border rounded" @change="saveAvatarConfig" />
                                </div>
                                <div>
                                    <label class="block text-sm text-gray-600 mb-1">高度</label>
                                    <input v-model.number="avatarHeight" type="number" class="w-full p-2 border rounded" @change="saveAvatarConfig" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Knowledge Tab -->
                    <div v-if="tab === 'knowledge'" class="space-y-4">
                        <div class="bg-gray-50 p-4 rounded-lg">
                            <h4 class="font-semibold mb-3">直播知识库</h4>
                            <div class="flex gap-2 mb-4">
                                <a-button
                                    v-for="type in knowledgeBizTypes"
                                    :key="type"
                                    :type="activeKnowledgeBiz === type ? 'primary' : 'default'"
                                    @click="activeKnowledgeBiz = type"
                                >
                                    {{ type }}
                                </a-button>
                            </div>
                            <div class="max-h-64 overflow-y-auto">
                                <div v-if="knowledgeRecords.length === 0" class="text-gray-400 text-center py-8">
                                    暂无数据
                                </div>
                                <div v-else v-for="item in knowledgeRecords" :key="item.id" class="flex items-center justify-between p-2 bg-white rounded mb-1">
                                    <span class="text-sm">{{ item.title }}</span>
                                    <a-switch :checked="item.content?.enable || false" />
                                </div>
                            </div>
                            <div class="mt-4">
                                <a-button type="primary" @click="saveKnowledge">
                                    <icon-check /> 保存更新
                                </a-button>
                            </div>
                        </div>
                    </div>

                    <!-- Event Tab -->
                    <div v-if="tab === 'event'" class="space-y-4">
                        <div class="bg-gray-50 p-4 rounded-lg">
                            <h4 class="font-semibold mb-3">直播互动设置</h4>
                            <div class="grid grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-sm text-gray-600 mb-1">默认用户名</label>
                                    <input v-model="eventDefaultUsername" class="w-full p-2 border rounded" @change="saveEventConfig" />
                                </div>
                                <div>
                                    <label class="block text-sm text-gray-600 mb-1">入场忽略时间（秒）</label>
                                    <input v-model.number="eventEnterIgnoreSecond" type="number" class="w-full p-2 border rounded" @change="saveEventConfig" />
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Talk History Tab -->
                    <div v-if="tab === 'liveTalk'" class="space-y-4">
                        <div class="bg-gray-50 p-4 rounded-lg">
                            <h4 class="font-semibold mb-3">播报历史</h4>
                            <div class="max-h-64 overflow-y-auto">
                                <div v-if="talkHistoryRecords.length === 0" class="text-gray-400 text-center py-8">
                                    暂无记录
                                </div>
                                <div v-else v-for="item in talkHistoryRecords" :key="item.id" class="p-2 bg-white rounded mb-1">
                                    <div class="text-sm font-medium">{{ item.title }}</div>
                                    <div class="text-xs text-gray-500 mt-1">{{ item.content?.text || '—' }}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Service Tab -->
                    <div v-if="tab === 'monitor'" class="space-y-4">
                        <div class="bg-gray-50 p-4 rounded-lg">
                            <h4 class="font-semibold mb-3">直播服务控制</h4>
                            <div class="flex items-center gap-2 mb-4">
                                <span class="text-gray-600">服务状态:</span>
                                <a-tag :color="liveStore.available ? 'green' : 'red'">
                                    {{ liveStore.available ? '运行中' : '已停止' }}
                                </a-tag>
                            </div>
                            <div class="flex gap-2">
                                <a-button type="primary" @click="startService" :disabled="isRunning">
                                    <icon-play-circle /> 启动服务
                                </a-button>
                                <a-button @click="stopService" :disabled="!isRunning">
                                    <icon-stop /> 停止服务
                                </a-button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped></style>
