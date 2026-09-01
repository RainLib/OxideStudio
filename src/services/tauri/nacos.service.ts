import { invokeWithInterceptors } from "./client";
import type {
  ExecuteNacosConfigTransferRequest,
  NacosConfigTransferPlan,
  NacosConfigTransferReceipt,
  NacosConfigTransferRequest,
} from "./types";

export const nacosService = {
  previewConfigTransfer: (request: NacosConfigTransferRequest) =>
    invokeWithInterceptors<NacosConfigTransferPlan>(
      "preview_nacos_config_transfer",
      { request },
    ),
  executeConfigTransfer: (request: ExecuteNacosConfigTransferRequest) =>
    invokeWithInterceptors<NacosConfigTransferReceipt>(
      "execute_nacos_config_transfer",
      { request },
    ),
};
