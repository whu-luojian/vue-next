// using literal strings instead of numbers so that it's easier to inspect
// debugger events

/**
 * 触发收集依赖的操作类型（读取了数据）
 */
export const enum TrackOpTypes {
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate' // 遍历
}

/**
 * 触发依赖更新的操作类型（更改了数据）
 */
export const enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear'
}
