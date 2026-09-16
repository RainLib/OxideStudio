export function hasWriteIntent(text: string) {
  return (
    /\b(create|delete|drop|insert|remove|replace|set|truncate|update|upsert|write)\b/.test(
      text,
    ) ||
    /创建|删除|移除|插入|新增|替换|设置|写入|更新|清空|截断|保存/.test(text)
  );
}

export function hasReadIntent(text: string) {
  return (
    /\b(get|read|show|fetch|inspect)\b/.test(text) ||
    /读取|查看|获取|查询|显示/.test(text)
  );
}

export function hasKeyReadIntent(text: string) {
  return (/\bkey\b/.test(text) || /键/.test(text)) && hasReadIntent(text);
}

export function hasMetadataIntent(text: string) {
  return (
    /\b(schema|table|collection|index|key|metadata|database|list)\b/.test(
      text,
    ) || /架构|模式|表|集合|索引|键|元数据|数据库|列出|列表/.test(text)
  );
}

export function hasQueryIntent(text: string) {
  return (
    /\b(query|select|find|search|run|execute|count|aggregate)\b/.test(text) ||
    /查询|搜索|运行|执行|计数|统计|聚合/.test(text)
  );
}

export function hasCountIntent(text: string) {
  return /\b(count|total)\b/.test(text) || /计数|统计|总数|数量/.test(text);
}

export function hasExplainIntent(text: string) {
  return (
    /\b(explain|diagnostic|error|fix|why|optimi[sz]e)\b/.test(text) ||
    /解释|诊断|错误|修复|为什么|优化|执行计划|查询计划/.test(text) ||
    hasQueryPlanIntent(text)
  );
}

export function hasQueryPlanIntent(message: string) {
  const text = message.toLowerCase();
  if (
    /\b(execution plan|query plan|optimi[sz]e|slow query|query performance)\b/.test(
      text,
    ) ||
    /执行计划|查询计划|慢查询|查询性能|优化/i.test(text)
  ) {
    return true;
  }
  if (/\b(diagnostic|error|fix)\b/.test(text) || /诊断|错误|修复/.test(text)) {
    return false;
  }
  return (
    /\b(explain|analy[sz]e)\b.*\b(query|sql|statement|plan|performance)\b/.test(
      text,
    ) ||
    /\b(query|sql|statement|plan|performance)\b.*\b(explain|analy[sz]e)\b/.test(
      text,
    ) ||
    /分析.*(?:查询|sql|语句)/i.test(text)
  );
}

export function hasWorkspaceIntent(text: string) {
  return (
    /\b(tab|selection|editor|workspace|current)\b/.test(text) ||
    /标签|选区|编辑器|工作区|当前/.test(text)
  );
}

export function hasDeleteIntent(text: string) {
  return /\b(delete|remove|unset)\b/.test(text) || /删除|移除|清除/.test(text);
}

export function hasUpdateIntent(text: string) {
  return (
    /\b(update|modify|patch|change)\b/.test(text) || /更新|修改|变更/.test(text)
  );
}

export function hasManyIntent(text: string) {
  return (
    /\b(all|many|multiple|bulk)\b/.test(text) ||
    /全部|所有|多条|批量/.test(text)
  );
}

export function hasUpsertIntent(text: string) {
  return (
    /\b(upsert|insert if missing|create if missing)\b/.test(text) ||
    /不存在则创建|不存在就创建|插入或更新/.test(text)
  );
}

export function hasCreateOrWriteIntent(text: string) {
  return (
    /\b(add|create|insert|new|write)\b/.test(text) ||
    /新增|创建|插入|写入|添加/.test(text)
  );
}

export function hasCreateSetOrWriteIntent(text: string) {
  return (
    /\b(add|create|set|write)\b/.test(text) ||
    /新增|创建|设置|写入|添加/.test(text)
  );
}

export function hasIndexWriteIntent(text: string) {
  return (
    /\b(add|create|index|replace|upsert|write)\b/.test(text) ||
    /新增|创建|索引|替换|写入|添加/.test(text)
  );
}
