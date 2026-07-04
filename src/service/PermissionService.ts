import { useServerStore } from "../store/modules/server";
import { useServerCloudStore } from "../store/modules/serverCloud";
import { EnumServerType } from "../types/Server";
import { Dialog } from "../lib/dialog";
import { t } from "../lang";

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
            const user = await window.$mapi.user.get();
            if (!user.user.id) {
                window.$mapi.user.open().then();
                return false;
            }
        }
        return true;
    },
};
