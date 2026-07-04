type MemberUserInfo = {
    user?: {
        id?: string | number | null;
        [key: string]: any;
    };
    data?: {
        vip?: {
            flag?: string | null;
            title?: string | null;
            isDefault?: boolean;
            [key: string]: any;
        };
        functions?: any;
        [key: string]: any;
    };
    [key: string]: any;
};

export const MEMBER_FEATURES = {
    PRO: "pro",
    CLOUD_MODEL: "cloud_model",
    CLOUD_TASK: "cloud_task",
    WORKFLOW: "workflow",
    LIVE: "live",
};

const truthyValues = ["1", "true", "yes", "on", "allow", "enabled"];

const normalize = (value: any) => String(value || "").trim().toLowerCase();

const hasUserId = (info: MemberUserInfo) => {
    return !!info?.user?.id;
};

const featureValueToBoolean = (value: any, level: string) => {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return value > 0;
    }
    if (typeof value === "string") {
        return truthyValues.includes(normalize(value));
    }
    if (Array.isArray(value)) {
        return value.map(normalize).includes(level);
    }
    if (value && typeof value === "object") {
        if (typeof value.enabled !== "undefined") {
            return featureValueToBoolean(value.enabled, level);
        }
        if (typeof value.allow !== "undefined") {
            return featureValueToBoolean(value.allow, level);
        }
        if (Array.isArray(value.levels)) {
            return value.levels.map(normalize).includes(level);
        }
    }
    return false;
};

export const MemberPermissionService = {
    memberLevel(info: MemberUserInfo) {
        return normalize(info?.data?.vip?.flag || "free") || "free";
    },

    memberTitle(info: MemberUserInfo) {
        return info?.data?.vip?.title || "";
    },

    isMember(info: MemberUserInfo) {
        return hasUserId(info) && info?.data?.vip?.isDefault === false;
    },

    hasFeature(
        info: MemberUserInfo,
        featureKey: string,
        aliases: string[] = [],
    ) {
        if (!hasUserId(info)) {
            return false;
        }

        const functions = info?.data?.functions;
        const level = this.memberLevel(info);
        const keys = [featureKey, ...aliases].filter(Boolean).map(normalize);
        const wildcardKeys = [MEMBER_FEATURES.PRO, "all", "*"];

        if (Array.isArray(functions)) {
            const values = functions.map(normalize);
            if (keys.some((key) => values.includes(key))) {
                return true;
            }
            if (wildcardKeys.some((key) => values.includes(key))) {
                return true;
            }
            return true;
        }

        if (functions && typeof functions === "object") {
            for (const key of keys) {
                if (Object.prototype.hasOwnProperty.call(functions, key)) {
                    return featureValueToBoolean(functions[key], level);
                }
            }
            for (const key of wildcardKeys) {
                if (Object.prototype.hasOwnProperty.call(functions, key)) {
                    return featureValueToBoolean(functions[key], level);
                }
            }
        }

        return true;
    },

    async openMemberCenter() {
        await window.$mapi.user.open();
    },
};
