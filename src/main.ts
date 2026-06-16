import "./electronFallback";
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import store from "./store";

import ArcoVue, { Message } from "@arco-design/web-vue";
import "@arco-design/web-vue/dist/arco.css";
import ArcoVueIcon from "@arco-design/web-vue/es/icon";

import { zhCN } from "date-fns/locale";
import timeago from "vue-timeago3";

import { i18n, t } from "./lang";

import { Dialog } from "./lib/dialog";
import "./style.less";

import { CommonComponents } from "./components/common";
import { useSettingStore } from "./store/modules/setting";
import { TaskManager } from "./task";

import { reportErrorRender } from "../electron/mapi/log/beacon-render";
import { TaskService } from "./service/TaskService";
import { useTaskStore } from "./store/modules/task";
import {
    initTestRegistry,
    registerGetTask,
    registerNavigate,
    testPushError,
    testRegistry,
} from "./utils/test";

const settingStore = useSettingStore();

const app = createApp(App);
app.use(ArcoVue);
app.use(ArcoVueIcon);
app.use(timeago, {
    converterOptions: {
        includeSeconds: false,
    },
    locale: zhCN,
});
app.use(CommonComponents);
app.use(i18n);
app.use(store);
app.use(router);
Message._context = app._context;
app.config.globalProperties.$mapi = window.$mapi;
app.config.globalProperties.$dialog = Dialog;
app.config.globalProperties.$t = t as any;
TaskManager.init();

// 注册工作流 channel 监听器：主进程调度 → 渲染进程执行
window["__page"].channel["workflow:execute"] = async ({
    workflowLogId,
    params,
}: {
    workflowLogId: string;
    params: any;
}) => {
    const taskStore = useTaskStore();
    taskStore.dispatch("Workflow", workflowLogId, params).then();
};
window["__page"].channel["workflow:cancel"] = async ({
    workflowLogId,
}: {
    workflowLogId: string;
}) => {
    const taskStore = useTaskStore();
    taskStore.requestCancel("Workflow", workflowLogId);
};

app.mount("#app").$nextTick(() => {
    postMessage({ payload: "removeLoading" }, "*");

    window.addEventListener("error", (ev) => {
        testPushError(ev.message || String(ev));
        reportErrorRender(
            ev.message,
            ev.error?.stack,
            ev.filename,
            ev.lineno,
            ev.colno,
        );
    });

    window.addEventListener("unhandledrejection", (ev) => {
        const err = ev.reason;
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        testPushError(msg);
        reportErrorRender(msg, stack);
    });

    initTestRegistry();
    window.__test = testRegistry;
    registerNavigate(async (path) => {
        await router.push(path);
    });
    registerGetTask(async (taskId) => {
        return await TaskService.get(taskId);
    });
});
