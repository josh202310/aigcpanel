<script setup lang="ts">
import PageHeader from "../components/PageHeader.vue";
</script>

<template>
    <div class="bg-white min-h-full select-none">
        <div class="p-6">
            <PageHeader :title="$t('workflow.title')" />
            <div class="flex items-center justify-center" style="height: calc(100vh - 10rem)">
                <div class="text-center text-gray-400">
                    <p class="text-xl">Workflows coming soon</p>
                </div>
            </div>
        </div>
    </div>
</template>
