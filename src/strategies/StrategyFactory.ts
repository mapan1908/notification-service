// src/strategies/StrategyFactory.ts
import { ChannelType } from '../types'; //
import { INotificationStrategy } from './NotificationStrategy'; // 我们上一步定义的接口
import { WecomBotStrategy } from './WecomBotStrategy'; // 我们已设计的第一个具体策略
// import { WechatMpStrategy } from './WechatMpStrategy'; // 未来会添加
// import { CloudSpeakerStrategy } from './CloudSpeakerStrategy'; // 未来会添加
import LoggerService from '../services/LoggerService'; //
import { WechatMpStrategy } from './WechatMpStrategy';

// 缓存策略实例，避免重复创建（简单实现，可选）
// 注意：如果策略是有状态的，或者每次调用需要全新实例，则不应缓存。
// 假设我们目前的策略是无状态的。
const strategyCache: Partial<Record<ChannelType, INotificationStrategy>> = {};

/**
 * 根据渠道类型获取相应的通知策略实例。
 * @param channelType - 通知渠道类型
 * @returns INotificationStrategy | null - 对应的策略实例，如果找不到则返回 null
 */
export function getNotificationStrategy(channelType: ChannelType): INotificationStrategy | null {
  // 检查缓存
  if (strategyCache[channelType]) {
    LoggerService.debug(`[StrategyFactory] Returning cached strategy for ${channelType}`);
    return strategyCache[channelType];
  }

  let strategyInstance: INotificationStrategy | null = null;

  switch (channelType) {
    case ChannelType.WECOM_BOT: //
      strategyInstance = new WecomBotStrategy();
      break;
    case ChannelType.WECHAT_MP: // <--- 新增 case
      strategyInstance = new WechatMpStrategy();
      break;
    // case ChannelType.CLOUD_SPEAKER: //
    //   strategyInstance = new CloudSpeakerStrategy();
    //   break;
    default:
      LoggerService.warn(`[StrategyFactory] 没有找到策略 for channel type: ${channelType}`);
      return null; // 或抛出错误，或返回一个默认的空操作策略
  }

  // 缓存新创建的实例
  if (strategyInstance) {
    strategyCache[channelType] = strategyInstance;
    LoggerService.debug(`[StrategyFactory] 创建并缓存策略 for ${channelType}`);
  }

  return strategyInstance;
}

/**
 * (可选) 清除策略缓存，例如在配置变更或测试时可能需要。
 */
export function clearStrategyCache(): void {
  for (const key in strategyCache) {
    delete strategyCache[key as ChannelType];
  }
  LoggerService.info('[StrategyFactory] Strategy cache cleared.');
}
