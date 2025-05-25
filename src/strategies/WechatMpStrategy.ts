// src/strategies/WechatMpStrategy.ts
import { request } from 'undici';
import get from 'lodash/get';
import { format } from 'date-fns';
import { config as appConfig } from '../config/config';
import LoggerService from '../services/LoggerService';
import AccessTokenService from '../services/AccessTokenService';
import ConfigService from '../services/ConfigService';
import { NotificationStatus } from '../types';
import { defaultHttpAgent } from '../utils/httpClient';
import { INotificationStrategy } from './NotificationStrategy';
import { NotificationPayload, SendResult } from '@/types/strategies.types';

interface WechatMpChannelParams {
  app_id: string;
  app_secret: string;
  open_id_field?: string;
  admin_open_id?: string[]; // 改为可选数组
  // also_send_to_admins?: boolean; // 可选：如果动态open_id存在，是否仍发送给admins，默认false
}

interface WechatTemplateSendApiResponse {
  errcode: number;
  errmsg: string;
  msgid?: number;
}

export class WechatMpStrategy implements INotificationStrategy {
  private readonly WECHAT_SEND_TEMPLATE_API = 'https://api.weixin.qq.com/cgi-bin/message/template/send';

  async send(payload: NotificationPayload): Promise<SendResult> {
    const { orderInfo, event, channelConfig } = payload;
    const logPrefix = `[WechatMpStrategy order:${orderInfo.order_id} event:${event} store:${channelConfig.store_code}]`; // 适配 store_code

    if (!channelConfig.channel_config || typeof channelConfig.channel_config !== 'object') {
      LoggerService.error(`${logPrefix} channel_config is missing or not an object.`);
      return { success: false, error: 'WeChat MP channel_config is missing or invalid.', status: NotificationStatus.FAILED };
    }
    const wechatParams = channelConfig.channel_config as WechatMpChannelParams;
    if (!wechatParams.app_id || !wechatParams.app_secret) {
      LoggerService.error(`${logPrefix} app_id or app_secret is missing in channel_config.`);
      return { success: false, error: 'WeChat MP app_id or app_secret is missing.', status: NotificationStatus.FAILED };
    }

    // 1. 确定最终要发送的 OpenID 列表
    const openIdsToSend: string[] = [];
    let dynamicOpenId: string | undefined;

    if (wechatParams.open_id_field) {
      dynamicOpenId = get(orderInfo, wechatParams.open_id_field) as string | undefined;
      if (dynamicOpenId) {
        openIdsToSend.push(dynamicOpenId);
        LoggerService.debug(`${logPrefix} Found dynamic OpenID: ${dynamicOpenId} from field '${wechatParams.open_id_field}'.`);
      } else {
        LoggerService.warn(`${logPrefix} Could not find dynamic OpenID from field '${wechatParams.open_id_field}'.`);
      }
    }

    // 根据业务逻辑决定是否合并 admin_open_id
    // 示例：如果动态OpenID存在，就不再发送给admin_open_id (除非有特定配置)
    // 或者，总是发送给 admin_open_id (如果存在)
    // 这里我们采用：如果动态OpenID不存在，则尝试admin_open_id；如果动态存在，也考虑是否要发给admin（简单起见，先不发给admin如果动态存在）
    // 您可以根据需求调整这个逻辑，例如增加一个 also_send_to_admins: true 的配置

    if (openIdsToSend.length === 0 && wechatParams.admin_open_id && wechatParams.admin_open_id.length > 0) {
      LoggerService.debug(`${logPrefix} No dynamic OpenID, using admin_open_id list.`);
      wechatParams.admin_open_id.forEach((id) => {
        if (id && !openIdsToSend.includes(id)) openIdsToSend.push(id);
      });
    } else if (wechatParams.admin_open_id && wechatParams.admin_open_id.length > 0 /* && wechatParams.also_send_to_admins */) {
      // 如果需要即使有动态OpenID也发送给admin，取消注释并实现 also_send_to_admins
      LoggerService.debug(`${logPrefix} Also sending to admin_open_id list.`);
      wechatParams.admin_open_id.forEach((id) => {
        if (id && !openIdsToSend.includes(id)) openIdsToSend.push(id); // 合并并去重
      });
    }

    if (openIdsToSend.length === 0) {
      LoggerService.error(`${logPrefix} No recipient OpenIDs could be determined.`);
      return { success: false, error: 'No recipient OpenIDs for WeChat MP notification.', status: NotificationStatus.FAILED };
    }

    LoggerService.info(`${logPrefix} Preparing to send to OpenIDs: ${openIdsToSend.join(', ')}`);

    // 2. 获取 Access Token (只需获取一次)
    const accessToken = await AccessTokenService.getAccessToken({
      app_id: wechatParams.app_id,
      app_secret: wechatParams.app_secret,
    });
    if (!accessToken) {
      LoggerService.error(`${logPrefix} Failed to get Access Token for app_id: ${wechatParams.app_id}.`);
      return { success: false, error: 'Failed to get WeChat Access Token.', status: NotificationStatus.FAILED };
    }

    // 3. 获取模板配置 (只需获取一次)
    // 确保 channelConfig.store_id 或 channelConfig.store_code 与 ConfigService 期望的一致
    const storeIdentifier = channelConfig.store_code;
    const templateConfigEntry = await ConfigService.getWechatTemplateConfig(storeIdentifier, event);
    if (!templateConfigEntry || !templateConfigEntry.enabled) {
      LoggerService.warn(`${logPrefix} No enabled WeChat template config found for event: ${event}.`);
      return { success: false, error: `No enabled WeChat template config for event ${event}.`, status: NotificationStatus.SKIPPED };
    }
    const { template_id, field_mapping, miniprogram, url: templateUrl } = templateConfigEntry;

    // 4. 根据 field_mapping 和 orderInfo 构造模板消息的 data 对象
    const templateData: Record<string, { value: string; color?: string }> = {};
    let allDataMappedSuccessfully = true; // 标志位，跟踪是否所有必需字段都成功映射

    for (const [templateKey, mappingInfo] of Object.entries(field_mapping)) {
      let rawValue: any;

      // 优先级 1: 使用 mappingInfo.value (固定值)
      if (mappingInfo.value !== undefined) {
        rawValue = mappingInfo.value;
        LoggerService.debug(`${logPrefix} Using fixed value for template key '${templateKey}': '${rawValue}'`);
      }
      // 优先级 2: 从 orderInfo 中按 field 路径取值
      else if (mappingInfo.field) {
        rawValue = get(orderInfo, mappingInfo.field);
        LoggerService.debug(`${logPrefix} Value from orderInfo for template key '${templateKey}' (field: '${mappingInfo.field}'):`, rawValue);
      }

      // 优先级 3: 如果上述都未取到值 (undefined 或 null)，则使用 mappingInfo.value_if_missing
      if ((rawValue === undefined || rawValue === null) && mappingInfo.value_if_missing !== undefined) {
        rawValue = mappingInfo.value_if_missing;
        LoggerService.debug(`${logPrefix} Using value_if_missing for template key '${templateKey}': '${rawValue}'`);
      }

      // 如果最终仍然没有值 (undefined/null)，则需要决定如何处理
      // 微信要求所有模板参数都必须有值。
      if (rawValue === undefined || rawValue === null) {
        LoggerService.warn(`${logPrefix} Value for template key '${templateKey}' (field: '${mappingInfo.field}') is MISSING and no fallback provided. Using a space placeholder.`);
        // 对于微信，空字符串会报错，至少需要一个空格。
        // 但对于时间、金额等类型，空格仍然会导致API端校验失败。
        // 如果一个关键字段缺失，可能应该标记整个通知发送失败或跳过此用户。
        // 这里我们先用空格，但您需要根据微信对该字段类型的要求来决定更好的备用值或处理逻辑。
        rawValue = ' ';
        // 可以考虑如果 mappingInfo 中有 required: true 且值缺失，则 allDataMappedSuccessfully = false;
      }

      let formattedValue = String(rawValue); // 默认为字符串

      // 格式化
      if (mappingInfo.format_type && rawValue !== ' ' && rawValue !== mappingInfo.value_if_missing) {
        // 只有当有真实值时才尝试格式化
        switch (mappingInfo.format_type) {
          case 'currency':
            const numValue = parseFloat(String(rawValue));
            if (!isNaN(numValue)) {
              formattedValue = `${numValue.toFixed(2)}${mappingInfo.currency_symbol || ''}`;
            } else {
              LoggerService.warn(`${logPrefix} Invalid number for currency formatting key '${templateKey}', value: '${rawValue}'. Using raw string.`);
              formattedValue = String(rawValue); // 无法格式化，使用原始字符串（或之前处理的空格/备用值）
            }
            break;
          case 'datetime':
            try {
              const dateToFormat = new Date(rawValue); // rawValue 必须是 Date 对象或可被 new Date() 解析的
              if (isNaN(dateToFormat.getTime())) {
                // 检查是否是无效日期
                LoggerService.warn(`${logPrefix} Invalid date value for key '${templateKey}', value: '${rawValue}'. Using raw string or placeholder.`);
                // 如果 rawValue 是 " "，new Date(" ") 也是 Invalid Date
                // 如果是关键的时间字段，且无法格式化，可能需要标记发送失败
                formattedValue = rawValue === ' ' ? ' ' : '时间格式错误'; // 或更合适的占位符
              } else {
                formattedValue = format(dateToFormat, mappingInfo.datetime_format || 'yyyy-MM-dd HH:mm:ss');
              }
            } catch (formatError) {
              LoggerService.warn(`${logPrefix} Failed to format datetime for key '${templateKey}', value: '${rawValue}'. Using raw string.`, formatError);
              formattedValue = String(rawValue);
            }
            break;
          default:
            // formattedValue 已是 String(rawValue)
            break;
        }
      }
      LoggerService.debug(`${logPrefix} Final value for template key '${templateKey}': '${formattedValue}'`);
      templateData[templateKey] = { value: formattedValue };
      if (mappingInfo.color) {
        templateData[templateKey].color = mappingInfo.color;
      }
    }

    // 检查是否有有效的 templateData key 被填充 (如果 field_mapping 不为空)
    // 并且检查 allDataMappedSuccessfully 标志 (如果实现了更严格的必需字段检查)
    if (Object.keys(templateData).length === 0 && Object.keys(field_mapping).length > 0 /* && !allDataMappedSuccessfully */) {
      LoggerService.error(`${logPrefix} No valid data could be mapped for template ${template_id}. Aborting send.`);
      // 对于多OpenID发送，这里应该只影响当前OpenID，而不是直接返回
      // individualResults.push({ openId, success: false, error: 'Failed to map any data for WeChat template.' });
      // continue; // 在循环中跳过此OpenID的发送
      // 如果是在单OpenID发送的逻辑中，可以直接返回失败
      return { success: false, error: 'Failed to map any data for WeChat template.', status: NotificationStatus.FAILED };
    }

    // ... (后续构造 baseRequestBody, 循环发送给 openIdsToSend, 调用微信 API 的逻辑不变) ...
    // ... 确保在循环发送单个OpenID时，如果 templateData 构造失败，则跳过该OpenID的发送并记录 ...

    // (在循环发送单个OpenID的逻辑中，如果因为templateData问题导致不能发送)
    // if (!allDataMappedSuccessfully && Object.keys(field_mapping).length > 0) {
    //   LoggerService.error(`${logPrefix} Critical data missing for template ${template_id} for OpenID: ${openId}. Skipping this recipient.`);
    //   individualResults.push({ openId, success: false, error: 'Critical data missing for template.' });
    //   continue; // 跳到下一个 OpenID
    // }

    // 5. 准备基础请求体 (不含 touser)
    const baseRequestBody: any = {
      template_id: template_id,
      data: templateData,
    };
    const placeholderRegex = /\{([^}]+)\}/g;
    const replacePlaceholders = (str: string) => {
      return str.replace(placeholderRegex, (match, p1) => {
        const val = get(orderInfo, p1.trim());
        return val !== undefined ? String(val) : match;
      });
    };
    if (templateUrl) {
      baseRequestBody.url = replacePlaceholders(templateUrl);
    }
    if (miniprogram && miniprogram.appid) {
      baseRequestBody.miniprogram = {
        appid: miniprogram.appid,
        pagepath: miniprogram.pagepath ? replacePlaceholders(miniprogram.pagepath) : undefined,
      };
    }

    // 6. 循环发送给每个 OpenID
    let overallSuccess = false;
    const individualResults: Array<{ openId: string; success: boolean; response?: WechatTemplateSendApiResponse; error?: string }> = [];

    for (const openId of openIdsToSend) {
      const requestBodyForUser = { ...baseRequestBody, touser: openId };
      const apiUrl = `${this.WECHAT_SEND_TEMPLATE_API}?access_token=${accessToken}`;
      LoggerService.debug(`${logPrefix} Sending template message to OpenID: ${openId}. URL: ${apiUrl.split('?')[0]}...`, { requestBody: requestBodyForUser });

      let timeoutIdLoop: NodeJS.Timeout | undefined;
      const controllerLoop = new AbortController();
      let attemptSuccess = false;
      let apiResponseData: WechatTemplateSendApiResponse | undefined;
      let attemptError: string | undefined;

      try {
        timeoutIdLoop = setTimeout(() => {
          LoggerService.warn(`${logPrefix} WeChat send API request for OpenID ${openId} is aborting due to timeout.`);
          controllerLoop.abort();
        }, appConfig.DEFAULT_HTTP_TIMEOUT_MS);

        const { statusCode, body } = await request(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(requestBodyForUser),
          dispatcher: defaultHttpAgent,
          signal: controllerLoop.signal,
        });
        clearTimeout(timeoutIdLoop);

        const responseText = await body.text();
        apiResponseData = JSON.parse(responseText) as WechatTemplateSendApiResponse;

        if (statusCode === 200 && apiResponseData.errcode === 0) {
          LoggerService.info(`${logPrefix} WeChat template message sent successfully to OpenID: ${openId}. MsgID: ${apiResponseData.msgid}`);
          attemptSuccess = true;
          overallSuccess = true; // 只要有一个成功，整体就标记为成功
        } else {
          attemptError = `WeChat API Error: ${apiResponseData.errmsg || 'Unknown error'} (Code: ${apiResponseData.errcode || statusCode})`;
          LoggerService.error(`${logPrefix} Failed to send WeChat template message to OpenID: ${openId}. Status: ${statusCode}`, {
            response: apiResponseData,
            requestSent: requestBodyForUser,
          });
        }
      } catch (error: any) {
        if (timeoutIdLoop && !controllerLoop.signal.aborted) clearTimeout(timeoutIdLoop);
        attemptError = error.name === 'AbortError' ? 'WeChat API request timed out' : error.message || 'Exception occurred';
        LoggerService.error(`${logPrefix} Exception while sending WeChat template message to OpenID: ${openId}:`, {
          error: error.message,
          requestSent: requestBodyForUser,
        });
      }
      individualResults.push({ openId, success: attemptSuccess, response: apiResponseData, error: attemptError });
    } // end for loop

    return {
      success: overallSuccess, // 或根据您的业务逻辑调整，例如所有都成功才算成功
      // messageId: N/A for multiple sends, or a concatenation, or first success.
      responseData: individualResults, // 返回每个OpenID的发送详情
      error: !overallSuccess ? 'One or more WeChat template messages failed to send.' : undefined,
      status: overallSuccess ? NotificationStatus.SUCCESS : NotificationStatus.FAILED,
    };
  }
}
