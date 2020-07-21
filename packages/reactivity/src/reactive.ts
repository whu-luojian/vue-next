/**
 * 导入工具方法：
 * isObject 判断是否是对象
 * toRawType 获取数据类型（使用Object.prototype.toString）
 * def 使用defineProperty设置一个不可枚举属性
 * hasOwn hasOwnProperty，指示对象自身属性中是否具有指定的属性
 * makeMap  根据给定的字符串（逗号分隔）生成map，并返回一个用于判断某个key是否存在于map中的函数
 */
import { isObject, toRawType, def, hasOwn, makeMap } from '@vue/shared'

/**
 * ES6 Proxy 的 handlers
 * 针对[Array, Object] 
 */
import {
  mutableHandlers,          // 可变数据的handler
  readonlyHandlers,         // 只读数据的handler
  shallowReactiveHandlers,  // 可变数据浅层（第一层）handler
  shallowReadonlyHandlers   // 只读数据浅层（第一次）handler
} from './baseHandlers'

/**
 * ES6 Proxy 的 handlers
 * 针对[Set, Map, WeakMap, WeakSet]
 */
import {
  mutableCollectionHandlers,    // 可变集合数据handler
  readonlyCollectionHandlers,   // 只读集合数据handler
  shallowCollectionHandlers     // 集合数据浅层（第一层）handler
} from './collectionHandlers'

/**
 * ref 泛型类型
 * Ref ref类型
 * UnWrapRef ref对象value的原始数据类型，如ref(0),则 UnWrapRef 为 number类型
 */
import { UnwrapRef, Ref } from './ref'

/**
 * 经过reactive(target)处理后的target 标志位属性枚举
 * __v_isReactive、__v_isReadonly、__v_raw三个属性在target上不是真实存在的，get时被代理函数拦截处理，返回对应的结果
 */
export const enum ReactiveFlags {
  SKIP = '__v_skip',                // 是否忽略，为true表示不可被代理，makeRaw(target)会将此属性置为true
  IS_REACTIVE = '__v_isReactive',   // 是否是响应式（reactive(target)）
  IS_READONLY = '__v_isReadonly',   // 是否只读的（readonly(target)）
  RAW = '__v_raw',                  // target 本身
  REACTIVE = '__v_reactive',        // 保存reactive(target)返回的响应式代理对象（new Proxy()）
  READONLY = '__v_readonly'         // 保存readonly(target)返回的只读代理对象（new Proxy()）
}

/**
 * 经过reactive(target)处理后的target
 * __v_isReactive、__v_isReadonly、__v_raw三个属性在target上不是真实存在的，get时被代理函数拦截处理，返回对应的结果
 */
interface Target {
  [ReactiveFlags.SKIP]?: boolean           // 是否忽略，为true表示不可被代理，makeRaw(target)会将此属性置为true
  [ReactiveFlags.IS_REACTIVE]?: boolean    // 是否是响应式（reactive(target)）
  [ReactiveFlags.IS_READONLY]?: boolean    // 是否只读的（readonly(target)）
  [ReactiveFlags.RAW]?: any                // target 本身
  [ReactiveFlags.REACTIVE]?: any           // 保存reactive(target)返回的响应式代理对象（new Proxy()）
  [ReactiveFlags.READONLY]?: any           // 保存readonly(target)返回的只读代理对象（new Proxy()）
}

// 支持响应式代理的javascript内建对象集合类型
const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
// 数据类型是否支持响应式代理，reactive仅支持Object,Array,Map,Set,WeakMap,WeakSet
const isObservableType = /*#__PURE__*/ makeMap(
  'Object,Array,Map,Set,WeakMap,WeakSet'
)

/**
 * 对象是否支持响应式代理
 * 1. value.__v_skip 不为 true （不被人为忽略）
 * 2. value 类型为 'Object,Array,Map,Set,WeakMap,WeakSet' 中的一种
 * 3. value 对象没有被冻结，被冻结的对象不可配置
 * @param value 对象
 */
const canObserve = (value: Target): boolean => {
  return (
    !value[ReactiveFlags.SKIP] &&
    isObservableType(toRawType(value)) &&
    !Object.isFrozen(value)
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

/**
 * reactive创建响应式代理，接收一个普通对象然后返回该普通对象的响应式代理，响应式转换是“深层的”：会影响对象内部所有嵌套的属性。
 * @param target 目标对象
 */
export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  // 如果target是由readonly创建的只读代理，直接返回target
  if (target && (target as Target)[ReactiveFlags.IS_READONLY]) {
    return target
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are reactive, and does NOT unwrap refs nor recursively convert
// returned properties.
export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers
  )
}

/**
 * 传入一个对象（响应式或普通）或 ref，返回一个原始对象的只读代理。一个只读的代理是“深层的”，对象内部任何嵌套的属性也都是只读的。
 * @param target 
 */
export function readonly<T extends object>(
  target: T
): Readonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are readonly, and does NOT unwrap refs nor recursively convert
// returned properties.
// This is used for creating the props proxy object for stateful components.
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    readonlyCollectionHandlers
  )
}

/**
 * 创建响应式代理
 * @param target 目标对象
 * @param isReadonly 是否只读，reactive()为false，readonly()为true
 * @param baseHandlers Array，Object对象的Proxy handlers
 * @param collectionHandlers [Set, Map, WeakMap, WeakSet]对象的Proxy handlers
 */
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  // 非对象类型（原始数据类型）不支持使用reactive做响应式代理
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // target上已有相关代理
  // target already has corresponding Proxy
  if (
    hasOwn(target, isReadonly ? ReactiveFlags.READONLY : ReactiveFlags.REACTIVE)
  ) {
    return isReadonly
      ? target[ReactiveFlags.READONLY]
      : target[ReactiveFlags.REACTIVE]
  }
  // only a whitelist of value types can be observed.
  if (!canObserve(target)) {
    return target
  }
  // 创建 Proxy 代理
  const observed = new Proxy(
    target,
    collectionTypes.has(target.constructor) ? collectionHandlers : baseHandlers
  )
  /**
   * 将new Proxy生成的[只读]代理对象保存在target对应的标志位属性上
   * observed上有target，target上有observed，两者循环引用
   */
  def(
    target,
    isReadonly ? ReactiveFlags.READONLY : ReactiveFlags.REACTIVE,
    observed
  )
  return observed
}

export function isReactive(value: unknown): boolean {
  // 如果value是只读代理
  if (isReadonly(value)) {
    // 判断target本身是否响应式代理
    return isReactive((value as Target)[ReactiveFlags.RAW])
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE])
}

export function isReadonly(value: unknown): boolean {
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY])
}

export function isProxy(value: unknown): boolean {
  return isReactive(value) || isReadonly(value)
}

/**
 * 返回由 reactive 或 readonly 方法转换成响应式代理的普通对象。
 * @param observed new Proxy 生成的代理
 */
export function toRaw<T>(observed: T): T {
  return (
    (observed && toRaw((observed as Target)[ReactiveFlags.RAW])) || observed
  )
}

/**
 * 显式标记一个对象为“永远不会转为响应式代理”
 * 给 value 添加 ReactiveFlags.SKIP(__v_skip)属性，值为true，表示响应式代理时会被忽略
 * @param value 对象
 */
export function markRaw<T extends object>(value: T): T {
  def(value, ReactiveFlags.SKIP, true)
  return value
}
