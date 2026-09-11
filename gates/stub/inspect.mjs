/**
 * T2 场景共用的事件读取助手（票据 07）——只读会话事件，不引用模型自述。
 *
 * `tool/call.arguments` 是生产适配器下发的原始 JSON 字符串；`request/header` 是
 * 模型实际看到的工具目录与路由，两个面都在会话日志里，断言只从这里取事实。
 *
 * 票 06 的 `bash-first-call` 保留自己的局部同名助手（其红绿证据与报告已归档，不做无谓改动）。
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

export function toolCallIdOf(resultEvent) {
  const block = resultEvent?.data?.message?.content?.find((entry) => entry.type === 'tool-result');
  return block?.toolCallId;
}

export function resultIsError(resultEvent) {
  const block = resultEvent?.data?.message?.content?.find((entry) => entry.type === 'tool-result');
  return block?.isError === true;
}

export function resultError(resultEvent) {
  const block = resultEvent?.data?.message?.content?.find((entry) => entry.type === 'tool-result');
  if (block?.isError !== true) return undefined;
  return block.content
    ?.map((entry) => (typeof entry?.text === 'string' ? entry.text : undefined))
    .filter((text) => text !== undefined)
    .join(' | ');
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
