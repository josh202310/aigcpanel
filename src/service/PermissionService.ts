import { useServerStore } from "../store/modules/server";
import { useServerCloudStore } from "../store/modules/serverCloud";
import { EnumServerType } from "../types/Server";
import { Dialog } from "../lib/dialog";
import { t } from "../lang";
import {
    MEMBER_FEATURES,
    MemberPermissionService,
} from "./MemberPermissionService";

const serverStore = useServerStore();
const serverCloudStore = useServerCloudStore();
export const PermissionService = {
    async checkForTask(
        biz: string,
        data: {
            serverName: string;
            serverVersion: string;
        },
    ) {
        const server =
            (await serverStore.getByNameVersion(
                data.serverName,
                data.serverVersion,
            )) ||
            (await serverCloudStore.getByNameVersion(
                data.serverName,
                data.serverVersion,
            ));
        if (!server) {
            throw "ServerNotFound";
        }
        if (server.type === EnumServerType.CLOUD) {
            Dialog.loadingOn(t("status.submitting"));
            const user = await window.$mapi.user.get();
            if (!user.user.id) {
                Dialog.loadingOff();
                window.$mapi.user.open().then();
                return false;
            }
            const allowed = MemberPermissionService.hasFeature(
                user,
                MEMBER_FEATURES.CLOUD_TASK,
                [MEMBER_FEATURES.CLOUD_MODEL, data.serverName, biz],
            );
            Dialog.loadingOff();
            if (!allowed) {
                Dialog.tipError(t("common.vipRequired"));
                setTimeout(() => {
                    window.$mapi.user.open().then();
                }, 1200);
                return false;
            }
        }
        return true;
    },
};
