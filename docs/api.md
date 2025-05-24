通知服务 API 文档 (当前已实现)本文档描述了通知服务当前已实现的 API 接口。基础 URL: http://localhost:3000 (或其他您配置的地址和端口)1. 服务健康与信息1.1 健康检查检查服务及其依赖（数据库、Redis）的健康状态。URL: /health方法: GET成功响应 (200 OK):{
  "status": "healthy", // "healthy" 或 "unhealthy"
  "timestamp": "2024-05-24T10:30:00.000Z",
  "service": "notification-service",
  "version": "1.0.0",
  "uptime": 12345.67, // 服务运行时间 (秒)
  "checks": {
    "database": "ok", // "ok" 或 "error"
    "redis": "ok"     // "ok" 或 "error"
  }
}
失败响应 (500 Internal Server Error): 如果服务不健康。{
    "error": true,
    "message": "Service unhealthy",
    "statusCode": 500,
    "timestamp": "2024-05-25T12:10:39.059Z"
}
1.2 服务基础信息获取服务的基础信息。URL: /方法: GET成功响应 (200 OK):{
  "service": "notification-service",
  "version": "1.0.0",
  "environment": "development", // 当前运行环境
  "timestamp": "2024-05-24T10:35:00.000Z",
  "endpoints": {
    "health": "/health",
    "api": "/api"
  }
}
2. 配置管理 API所有配置管理相关的 API 都在 /api 路径下。2.1 获取商家通知渠道配置获取指定商家的通知渠道配置列表。URL: /api/stores/:storeId/channels方法: GET路径参数:storeId (string, 必填): 商家 ID。查询参数:orderType (string, 可选): 订单类型 (如 dine_in, pickup, delivery)。如果提供，则只返回该订单类型的配置。成功响应 (200 OK):{
  "success": true,
  "data": [
    {
      "id": 1,
      "store_id": 101,
      "order_type": "pickup",
      "channel_type": "wechat_mp",
      "channel_config": {
        "app_id": "wx1234567890",
        "app_secret": "your_app_secret",
        "template_id": "template_001",
        "open_id": "user_openid"
      },
      "enabled": true,
      "created_at": "2024-05-24T08:00:00.000Z",
      "updated_at": "2024-05-24T08:00:00.000Z"
    }
    // ...更多配置
  ]
}
失败响应:500 Internal Server Error: 服务器内部错误。2.2 创建通知渠道配置为指定商家创建一个新的通知渠道配置。URL: /api/stores/:storeId/channels方法: POST路径参数:storeId (string, 必填): 商家 ID。请求体 (JSON):{
  "order_type": "pickup", // 订单类型, 枚举值: "dine_in", "pickup", "delivery"
  "channel_type": "wechat_mp", // 渠道类型, 枚举值: "wechat_mp", "wecom_bot", "cloud_speaker"
  "channel_config": { // 具体渠道的配置对象
    // 示例: 微信公众号
    "app_id": "wx_app_id",
    "app_secret": "wx_app_secret",
    "template_id": "wx_template_id",
    "open_id": "user_open_id"
    // 示例: 企业微信机器人
    // "webhook_url": "[https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx](https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx)"
    // "mention_list": ["@all"]
    // 示例: 云喇叭
    // "api_url": "[http://speaker.api/send](http://speaker.api/send)",
    // "device_id": "speaker_device_123"
  },
  "enabled": true // 可选, 默认为 true
}
成功响应 (201 Created):{
  "success": true,
  "data": {
    "id": 123 // 新创建的配置 ID
  },
  "message": "Channel configuration created successfully"
}
失败响应:400 Bad Request: 请求体验证失败 (例如，channel_config 缺少必要字段)。{
  "success": false,
  "message": "Invalid channel configuration",
  "errors": [
    "app_id is required"
  ]
}
500 Internal Server Error: 创建失败。2.3 更新通知渠道配置更新已存在的通知渠道配置。URL: /api/channels/:id方法: PUT路径参数:id (string, 必填): 要更新的通知渠道配置的 ID。请求体 (JSON): (至少包含以下一个字段){
  "channel_config": { // 可选, 更新后的渠道配置对象
    "app_id": "new_wx_app_id",
    "app_secret": "new_wx_app_secret",
    "template_id": "new_wx_template_id",
    "open_id": "new_user_open_id"
  },
  "enabled": false // 可选, 更新启用状态
}
成功响应 (200 OK):{
  "success": true,
  "message": "Channel configuration updated successfully"
}
失败响应:400 Bad Request: 如果 channel_config 提供了但验证失败。500 Internal Server Error: 更新失败或配置不存在。2.4 创建微信模板配置为指定商家创建一个新的微信模板配置。URL: /api/stores/:storeId/wechat-templates方法: POST路径参数:storeId (string, 必填): 商家 ID。请求体 (JSON):{
  "template_id": "wechat_template_xyz",
  "template_name": "新订单通知模板",
  "event_type": "order_created", // 事件类型, 枚举值见 src/types/index.ts NotificationEventType
  "field_mapping": { // 模板字段映射
    "first": "您有新的订单！",
    "keyword1": "{order_number}", // {order_number} 将被替换为实际订单号
    "keyword2": "{payable_amount} 元",
    "remark": "请及时处理。"
  },
  "enabled": true // 可选, 默认为 true
}
成功响应 (201 Created):{
  "success": true,
  "data": {
    "id": 456 // 新创建的微信模板配置 ID
  },
  "message": "Wechat template created successfully"
}
失败响应:500 Internal Server Error: 创建失败。2.5 测试配置验证测试给定的渠道配置是否有效。URL: /api/test-config方法: POST请求体 (JSON):{
  "channel_type": "wechat_mp", // 要测试的渠道类型
  "channel_config": { // 要测试的渠道配置
    "app_id": "test_app_id",
    "app_secret": "test_app_secret",
    "template_id": "test_template_id",
    "open_id": "test_open_id"
  }
}
成功响应 (200 OK):如果配置有效:{
  "success": true,
  "errors": [],
  "message": "Configuration is valid"
}
如果配置无效:{
  "success": false,
  "errors": [
    "app_id is required" // 具体的错误信息
  ],
  "message": "Configuration validation failed"
}
3. 错误响应通用格式当 API 调用发生错误时，通常会返回以下格式的 JSON：{
  "error": true,
  "message": "具体的错误描述",
  "statusCode": 400, // HTTP 状态码
  "timestamp": "2024-05-24T12:00:00.000Z"
  // "errors": [] // (可选) 详细的验证错误列表
}
4. 枚举值参考请参考项目中的 src/types/index.ts 文件获取以下枚举的最新值：ChannelType: 通知渠道类型NotificationEventType: 通知事件类型OrderType: 订单类型注意:本文档仅包含截至目前已在代码中明确实现的接口。随着项目开发，新的接口会被添加，现有接口也可能发生变化。