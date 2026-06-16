const memoryStorage = new Map<string, any>();

const noopAsync = async () => undefined;

const createFallbackPage = () => ({
    hooks: {},
    broadcastListeners: {},
    callPage: {},
    channel: {},
    onShow: noopAsync,
    onHide: noopAsync,
    onMaximize: noopAsync,
    onUnmaximize: noopAsync,
    onEnterFullScreen: noopAsync,
    onLeaveFullScreen: noopAsync,
    onShowQuitConfirmDialog: noopAsync,
    onBroadcast(type: string, cb: (data: any) => void) {
        this.broadcastListeners[type] = this.broadcastListeners[type] || [];
        this.broadcastListeners[type].push(cb);
    },
    offBroadcast(type: string, cb: (data: any) => void) {
        if (!this.broadcastListeners[type]) {
            return;
        }
        this.broadcastListeners[type] = this.broadcastListeners[type].filter(
            (item: any) => item !== cb,
        );
    },
    registerCallPage(name: string, cb: any) {
        this.callPage[name] = cb;
    },
    createChannel(cb: any) {
        const channel = Math.random().toString(36).slice(2);
        this.channel[channel] = cb;
        return channel;
    },
    destroyChannel(channel: string) {
        delete this.channel[channel];
    },
    ipcSendToHost: noopAsync,
    ipcSend: noopAsync,
});

const createFallbackMapi = () => ({
    app: {
        isDarkMode: async () => false,
        getBuildInfo: async () => ({ buildId: "browser-preview" }),
        setupIsOk: async () => true,
        windowOpen: noopAsync,
        windowMax: noopAsync,
        openExternal: noopAsync,
        toast: noopAsync,
        setClipboardText: async (text: string) => {
            await navigator.clipboard?.writeText(text).catch(() => undefined);
        },
        isPlatform: (platform: string) => platform === "web",
        platformName: () => "web",
        platformArch: () => "browser",
        getUserAgent: () => navigator.userAgent,
        getPreload: async () => "",
        spawnBinary: async () => {
            throw new Error("Browser preview does not support native binary calls");
        },
    },
    config: {
        all: async () => ({}),
        get: async (key: string, defaultValue: any = null) =>
            memoryStorage.has(`config:${key}`)
                ? memoryStorage.get(`config:${key}`)
                : defaultValue,
        allEnv: async () => ({}),
        getEnv: async (key: string, defaultValue: any = null) =>
            memoryStorage.has(`configEnv:${key}`)
                ? memoryStorage.get(`configEnv:${key}`)
                : defaultValue,
        set: async (key: string, value: any) => {
            memoryStorage.set(`config:${key}`, value);
        },
        setEnv: async (key: string, value: any) => {
            memoryStorage.set(`configEnv:${key}`, value);
        },
    },
    user: {
        get: async () => ({
            apiToken: "browser-preview",
            user: {
                id: "browser-preview",
                name: "Browser Preview",
                avatar: "",
                deviceCode: "",
                username: "browser-preview",
            },
            data: {
                vip: {
                    id: "browser-preview",
                    flag: "local_pro",
                    title: "本地 Pro 会员",
                    icon: "",
                    isDefault: false,
                },
                functions: {
                    all: true,
                    pro: true,
                    cloud_model: true,
                    cloud_task: true,
                    workflow: true,
                    live: true,
                },
                quota: {},
                usage: {},
            },
            basic: { userEnable: true },
        }),
        open: noopAsync,
        openWebUrl: noopAsync,
        refresh: noopAsync,
        apiPost: async (path: string) => {
            if (path === "server/all") {
                return { code: 0, msg: "ok", data: { records: [] } };
            }
            if (path.includes("usage/summary")) {
                return { code: 0, msg: "ok", data: { quota: {} } };
            }
            if (path.includes("usage/records")) {
                return { code: 0, msg: "ok", data: { records: [] } };
            }
            return { code: 0, msg: "ok", data: {} };
        },
    },
    storage: {
        get: async (module: string, key: string, defaultValue: any = null) =>
            memoryStorage.has(`${module}:${key}`)
                ? memoryStorage.get(`${module}:${key}`)
                : defaultValue,
        set: async (module: string, key: string, value: any) => {
            memoryStorage.set(`${module}:${key}`, value);
        },
    },
    file: {
        list: async () => [],
        read: async () => "",
        exists: async () => false,
        fullPath: async (value: string) => value,
        deletes: noopAsync,
    },
    server: {
        config: async () => ({ code: -1, msg: "BrowserPreview", data: null }),
        isSupport: async () => false,
        start: noopAsync,
        stop: noopAsync,
        cancel: noopAsync,
        ping: async () => false,
        callFunctionWithException: async () => {
            throw new Error("Browser preview does not support server calls");
        },
        deletes: noopAsync,
    },
    db: {},
    env: {},
    log: {
        appError: noopAsync,
        appInfo: noopAsync,
    },
});

export const installElectronFallback = () => {
    if (!(window as any).__page) {
        (window as any).__page = createFallbackPage();
    }
    if (!(window as any).$mapi) {
        (window as any).$mapi = createFallbackMapi();
    }
};

installElectronFallback();
