<script setup lang="ts">
import ProUpgradeView from "../components/common/ProUpgradeView.vue";
import PageHeader from "../components/PageHeader.vue";
</script>

<template>
    <div class="bg-white min-h-full select-none">
        <div class="p-6">
            <PageHeader :title="$t('workflow.title')" />
            <div style="height: calc(100vh - 10rem)">
                <ProUpgradeView :desc="$t('proUpgrade.defaultDesc')" />
            </div>
        </div>
    </div>
</template>
