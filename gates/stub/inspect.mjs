/**
 * T2 场景共用的事件读取助手（票据 07）——只读会话事件，不引用模型自述。
 *
 * `tool/call.arguments` 是生产适配器下发的原始 JSON 字符串；`request/header` 是
 * 模型实际看到的工具目录与路由，两个面都在会话日志里，断言只从这里取事实。
 *
 * 0.1.7 会话格式 V4：tool/result 的调用身份与错误位在 first-class message 上
 * （`data.message.toolCallId` / `data.message.isError`），内容块不再有
 * `tool-result` 包装（V4 明确拒收）；`data.error` 只在错误结果上出现。
 */

export function safeJson(text) {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function requestHeaders(events) {
  return events.filter((event) => event.type === 'request/header');
}

export function headerConfig(headerEvent) {
  return headerEvent?.data?.header?.config;
}

export function headerToolNames(headerEvent) {
  return (headerEvent?.data?.header?.tools ?? []).map((tool) => tool.name);
}

export function bashParamKeys(headerEvent) {
  const bash = (headerEvent?.data?.header?.tools ?? []).find((tool) => tool.name === 'bash');
  return Object.keys(bash?.parameters?.properties ?? {});
}

/** V4：调用身份在 first-class tool-role message 上（内容块不再有 tool-result 包装）。 */
export function toolCallIdOf(resultEvent) {
  return resultEvent?.data?.message?.toolCallId;
}

export function resultIsError(resultEvent) {
  return resultEvent?.data?.message?.isError === true;
}

export function resultError(resultEvent) {
  if (!resultIsError(resultEvent)) return undefined;
  const blocks = resultEvent?.data?.message?.content ?? [];
  const texts = blocks.map((entry) => (typeof entry?.text === 'string' ? entry.text : undefined)).filter((text) => text !== undefined);
  if (texts.length > 0) return texts.join(' | ');
  return resultEvent?.data?.error === undefined ? undefined : JSON.stringify(resultEvent.data.error);
}

/** 路由标签，证据里统一写法：`provider/model`。 */
export function routeLabel(route) {
  return route === undefined ? '<none>' : `${String(route.provider)}/${String(route.model)}`;
}

/** 按名字取 tool/call 事件。 */
export function callsByName(events, name) {
  return events.filter((event) => event.type === 'tool/call' && event.data?.name === name);
}

/** 取某个 callId 的 tool/result 事件。 */
export function resultOfCall(events, callId) {
  return events.find((event) => event.type === 'tool/result' && toolCallIdOf(event) === callId);
}

/**
 * Q25 路由护栏（票据 12 审查 Standards#3 抽公共）：首个 request/header 必须落在
 * 假模型上，防「忘改路由 → 打真实 provider」。返回 `{ ok, evidence }` 供场景 push。
 */
export function routeGuard(events, label = 'request/header#1') {
  const config = headerConfig(requestHeaders(events)[0]);
  return {
    ok: config?.provider === 'stub' && config?.model === 'stub-model',
    evidence: `${label} config=${routeLabel(config)}`,
  };
}

/** 会话正常收尾：最后一个 turn/end 的 reason.kind === 'completed'。返回 `{ ok, evidence }`。 */
export function turnCompleted(events, label = 'turn/end') {
  const lastTurnEnd = events.filter((event) => event.type === 'turn/end').at(-1);
  return {
    ok: lastTurnEnd?.data?.reason?.kind === 'completed',
    evidence: `${label} reason=${JSON.stringify(lastTurnEnd?.data?.reason ?? null)}`,
  };
}
