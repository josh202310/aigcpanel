<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import Router from "../router";
import ProUpgradeView from "../components/common/ProUpgradeView.vue";
import PageHeader from "../components/PageHeader.vue";

const tab = ref("");

const syncTab = () => {
    tab.value = (Router.currentRoute.value.query.tab as string) || "monitor";
};

onMounted(() => {
    syncTab();
});

watch(() => Router.currentRoute.value.query.tab, syncTab);
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
                    <i-mdi-broadcast
                        class="w-5 h-5 inline-block mr-1 text-rose-500"
                    />
                    {{ $t("live.service") }}
                </div>
            </div>
            <div
                class="p-2 rounded-lg mb-4 cursor-pointer"
                :class="tab === 'avatar' ? 'bg-gray-200' : ''"
                @click="tab = 'avatar'"
            >
                <div class="text-base flex items-center">
                    <i-mdi-account-circle
                        class="w-5 h-5 inline-block mr-1 text-blue-500"
                    />
                    {{ $t("live.avatar") }}
                </div>
            </div>
            <div
                class="p-2 rounded-lg mb-4 cursor-pointer"
                :class="tab === 'knowledge' ? 'bg-gray-200' : ''"
                @click="tab = 'knowledge'"
            >
                <div class="text-base flex items-center">
                    <i-mdi-book-open-variant
                        class="w-5 h-5 inline-block mr-1 text-amber-500"
                    />
                    {{ $t("live.knowledge") }}
                </div>
            </div>
            <div
                class="p-2 rounded-lg mb-4 cursor-pointer"
                :class="tab === 'event' ? 'bg-gray-200' : ''"
                @click="tab = 'event'"
            >
                <div class="text-base flex items-center">
                    <i-mdi-chat
                        class="w-5 h-5 inline-block mr-1 text-emerald-500"
                    />
                    {{ $t("live.event") }}
                </div>
            </div>
            <div
                class="p-2 rounded-lg mb-4 cursor-pointer"
                :class="tab === 'liveTalk' ? 'bg-gray-200' : ''"
                @click="tab = 'liveTalk'"
            >
                <div class="text-base flex items-center">
                    <i-mdi-history
                        class="w-5 h-5 inline-block mr-1 text-violet-500"
                    />
                    {{ $t("live.talkHistory") }}
                </div>
            </div>
        </div>
        <div class="flex-grow h-full overflow-y-auto">
            <div class="p-6">
                <PageHeader :title="$t('live.title')" />
                <div style="height: calc(100vh - 10rem)">
                    <ProUpgradeView />
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped></style>
