import packageJson from "../package.json";

const BASE_URL = "https://aigcpanel.com";
const MEMBER_API_BASE_URL = "http://127.0.0.1:18080/api";

export const AppConfig = {
    name: "AIGCPanel",
    title: "AIGCPanel",
    slogan: "一站式AI数字人系统",
    version: packageJson.version,
    website: `${BASE_URL}`,
    websiteGithub: "https://github.com/modstart-lib/aigcpanel",
    websiteGitee: "https://gitee.com/modstart-lib/aigcpanel",
    apiBaseUrl: `${BASE_URL}/api`,
    memberApiBaseUrl: MEMBER_API_BASE_URL,
    updaterUrl: `${BASE_URL}/app_manager/updater/open`,
    downloadUrl: `${BASE_URL}/app_manager/download`,
    feedbackUrl: `${BASE_URL}/feedback_ticket`,
    statisticsUrl: `${BASE_URL}/app_manager/collect`,
    guideUrl: `${BASE_URL}/app_manager/guide`,
    helpUrl: `${BASE_URL}/app_manager/help`,
    serverUrl: `${BASE_URL}/aigcpanel/`,
    basic: {
        userEnable: true,
    },
};
