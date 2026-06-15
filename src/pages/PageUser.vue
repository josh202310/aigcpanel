<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import DefaultAvatar from "../assets/image/avatar.svg";
import { Dialog } from "../lib/dialog";
import { useUserStore } from "../store/modules/user";

type QuotaItem = {
    amountType?: string;
    limit?: number;
    used?: number;
    remaining?: number;
    resetCycle?: string;
    resetAt?: number;
};

type UsageRecord = {
    id: number;
    scene: string;
    providerId?: string;
    modelId?: string;
    biz?: string;
    taskId?: string;
    amount: number;
    amountType: string;
    status: string;
    createdAt: number;
};

const user = useUserStore();
const loading = ref(false);
const recordLoading = ref(false);
const activeAuthTab = ref("login");
const usageRecords = ref<UsageRecord[]>([]);
const connectError = ref("");

const loginForm = reactive({
    username: "demo",
    password: "demo123456",
});

const registerForm = reactive({
    username: "",
    password: "",
    name: "",
});

const isLoggedIn = computed(() => !!user.user.id);
const quotaMap = computed<Record<string, QuotaItem>>(() => {
    return (user.data?.quota || user.data?.usage || {}) as Record<
        string,
        QuotaItem
    >;
});
const quotaItems = computed(() => {
    return Object.entries(quotaMap.value).map(([scene, item]) => ({
        scene,
        ...item,
        percent:
            item.limit && item.limit > 0
                ? Math.min(100, Math.round(((item.used || 0) / item.limit) * 100))
                : 0,
    }));
});
const vipTitle = computed(() => user.data?.vip?.title || "本地会员");
const totalRemaining = computed(() => {
    return quotaItems.value.reduce((sum, item) => sum + (item.remaining || 0), 0);
});

const sceneTitle = (scene: string) => {
    const map: Record<string, string> = {
        llm_chat: "大模型对话",
        task: "任务调用",
        sound_tts: "语音合成",
        asr: "语音识别",
        video_gen: "数字人视频",
        text_to_image: "文生图",
        image_to_image: "图生图",
    };
    return map[scene] || scene;
};

const formatTime = (value?: number) => {
    if (!value) return "-";
    return new Date(value).toLocaleString();
};

const saveUserData = async (payload: any) => {
    await window.$mapi.user.save({
        apiToken: payload.apiToken || "",
        user: payload.user || {},
        data: payload.data || {},
        basic: payload.basic || {},
    });
    await user.load();
};

const refreshUser = async () => {
    loading.value = true;
    connectError.value = "";
    try {
        await window.$mapi.user.refresh();
        await user.load();
        await loadUsageRecords();
    } catch (e: any) {
        connectError.value = String(e || "会员服务连接失败");
    } finally {
        loading.value = false;
    }
};

const doLogin = async () => {
    if (!loginForm.username || !loginForm.password) {
        Dialog.tipError("请输入用户名和密码");
        return;
    }
    loading.value = true;
    connectError.value = "";
    try {
        const res = await window.$mapi.user.apiPost(
            "user/login",
            { ...loginForm },
            { throwException: false },
        );
        if (res.code) {
            Dialog.tipError(res.msg || "登录失败");
            return;
        }
        await saveUserData(res.data);
        await loadUsageRecords();
        Dialog.tipSuccess("登录成功");
    } catch (e: any) {
        connectError.value = String(e || "会员服务连接失败");
    } finally {
        loading.value = false;
    }
};

const doRegister = async () => {
    if (!registerForm.username || !registerForm.password) {
        Dialog.tipError("请输入用户名和密码");
        return;
    }
    loading.value = true;
    connectError.value = "";
    try {
        const res = await window.$mapi.user.apiPost(
            "user/register",
            { ...registerForm },
            { throwException: false },
        );
        if (res.code) {
            Dialog.tipError(res.msg || "注册失败");
            return;
        }
        await saveUserData(res.data);
        await loadUsageRecords();
        Dialog.tipSuccess("注册成功");
    } catch (e: any) {
        connectError.value = String(e || "会员服务连接失败");
    } finally {
        loading.value = false;
    }
};

const doLogout = async () => {
    loading.value = true;
    try {
        await window.$mapi.user.apiPost(
            "user/logout",
            {},
            { throwException: false },
        );
    } finally {
        await saveUserData({
            apiToken: "",
            user: {},
            data: {},
            basic: { userEnable: true },
        });
        usageRecords.value = [];
        loading.value = false;
    }
};

const loadUsageRecords = async () => {
    if (!user.apiToken) return;
    recordLoading.value = true;
    try {
        const res = await window.$mapi.user.apiPost(
            "usage/records",
            { limit: 20, offset: 0 },
            { throwException: false },
        );
        if (!res.code) {
            usageRecords.value = res.data?.records || [];
        }
    } finally {
        recordLoading.value = false;
    }
};

onMounted(async () => {
    await user.waitInit();
    if (isLoggedIn.value) {
        await refreshUser();
    }
});
</script>

<template>
    <div class="member-page h-full overflow-auto bg-gray-50 dark:bg-gray-900">
        <div class="member-inner mx-auto px-5 py-5">
            <div class="flex items-center justify-between mb-4 gap-3">
                <div>
                    <div class="text-xl font-bold">会员中心</div>
                    <div class="text-gray-500 text-sm mt-1">
                        管理登录状态、会员配额和调用记录
                    </div>
                </div>
                <div class="flex gap-2">
                    <a-button @click="refreshUser" :loading="loading">
                        <template #icon><icon-refresh /></template>
                        刷新
                    </a-button>
                    <a-button v-if="isLoggedIn" status="danger" @click="doLogout">
                        退出
                    </a-button>
                </div>
            </div>

            <a-alert
                v-if="connectError"
                class="mb-4"
                type="warning"
                :content="`会员服务不可用：${connectError}`"
            />

            <template v-if="!isLoggedIn">
                <div class="auth-panel bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-5">
                    <a-tabs v-model:active-key="activeAuthTab">
                        <a-tab-pane key="login" title="登录">
                            <a-form :model="loginForm" layout="vertical">
                                <a-form-item label="用户名">
                                    <a-input v-model="loginForm.username" />
                                </a-form-item>
                                <a-form-item label="密码">
                                    <a-input-password v-model="loginForm.password" />
                                </a-form-item>
                                <a-button type="primary" long @click="doLogin" :loading="loading">
                                    登录会员
                                </a-button>
                            </a-form>
                        </a-tab-pane>
                        <a-tab-pane key="register" title="注册">
                            <a-form :model="registerForm" layout="vertical">
                                <a-form-item label="用户名">
                                    <a-input v-model="registerForm.username" />
                                </a-form-item>
                                <a-form-item label="昵称">
                                    <a-input v-model="registerForm.name" />
                                </a-form-item>
                                <a-form-item label="密码">
                                    <a-input-password v-model="registerForm.password" />
                                </a-form-item>
                                <a-button type="primary" long @click="doRegister" :loading="loading">
                                    注册并登录
                                </a-button>
                            </a-form>
                        </a-tab-pane>
                    </a-tabs>
                </div>
            </template>

            <template v-else>
                <div class="summary-grid mb-4">
                    <div class="summary-panel bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">
                        <div class="flex items-center gap-3">
                            <img
                                class="w-14 h-14 rounded-full border border-gray-200"
                                :src="user.user.avatar || DefaultAvatar"
                            />
                            <div class="min-w-0">
                                <div class="font-bold text-lg truncate">
                                    {{ user.user.name || '未命名用户' }}
                                </div>
                                <div class="text-gray-500 text-sm truncate">
                                    ID {{ user.user.id }}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="summary-panel bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">
                        <div class="text-gray-500 text-sm">当前会员</div>
                        <div class="font-bold text-lg mt-2">{{ vipTitle }}</div>
                        <div class="text-gray-500 text-sm mt-1">
                            {{ user.data?.vip?.flag || 'local' }}
                        </div>
                    </div>
                    <div class="summary-panel bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">
                        <div class="text-gray-500 text-sm">剩余总额度</div>
                        <div class="font-bold text-lg mt-2">{{ totalRemaining }}</div>
                        <div class="text-gray-500 text-sm mt-1">按当前配额项汇总</div>
                    </div>
                </div>

                <div class="section bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4 mb-4">
                    <div class="font-bold mb-3">配额余额</div>
                    <a-empty v-if="quotaItems.length === 0" description="暂无配额数据" />
                    <div v-else class="quota-grid">
                        <div
                            v-for="item in quotaItems"
                            :key="item.scene"
                            class="quota-item border border-gray-100 dark:border-gray-700 rounded p-3"
                        >
                            <div class="flex justify-between gap-2 mb-2">
                                <div class="font-medium truncate">{{ sceneTitle(item.scene) }}</div>
                                <div class="text-gray-500 text-xs">{{ item.amountType || 'count' }}</div>
                            </div>
                            <a-progress :percent="item.percent / 100" size="small" />
                            <div class="flex justify-between text-sm text-gray-500 mt-2">
                                <span>已用 {{ item.used || 0 }}</span>
                                <span>剩余 {{ item.remaining || 0 }}</span>
                            </div>
                            <div class="text-xs text-gray-400 mt-1">
                                重置：{{ formatTime(item.resetAt) }}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="section bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-4">
                    <div class="flex items-center justify-between mb-3">
                        <div class="font-bold">最近调用记录</div>
                        <a-button size="small" @click="loadUsageRecords" :loading="recordLoading">
                            <template #icon><icon-refresh /></template>
                        </a-button>
                    </div>
                    <a-table
                        :data="usageRecords"
                        :pagination="false"
                        size="small"
                        row-key="id"
                    >
                        <template #columns>
                            <a-table-column title="场景" data-index="scene">
                                <template #cell="{ record }">
                                    {{ sceneTitle(record.scene) }}
                                </template>
                            </a-table-column>
                            <a-table-column title="模型" data-index="modelId">
                                <template #cell="{ record }">
                                    {{ record.modelId || record.biz || '-' }}
                                </template>
                            </a-table-column>
                            <a-table-column title="消耗" data-index="amount" :width="90">
                                <template #cell="{ record }">
                                    {{ record.amount }} {{ record.amountType }}
                                </template>
                            </a-table-column>
                            <a-table-column title="状态" data-index="status" :width="90" />
                            <a-table-column title="时间" data-index="createdAt" :width="170">
                                <template #cell="{ record }">
                                    {{ formatTime(record.createdAt) }}
                                </template>
                            </a-table-column>
                        </template>
                    </a-table>
                </div>
            </template>
        </div>
    </div>
</template>

<style lang="less" scoped>
.member-inner {
    max-width: 960px;
}

.auth-panel {
    max-width: 420px;
    margin: 24px auto 0;
}

.summary-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
}

.quota-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
}

@media (max-width: 760px) {
    .summary-grid,
    .quota-grid {
        grid-template-columns: 1fr;
    }
}
</style>
