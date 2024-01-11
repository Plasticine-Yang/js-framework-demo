/*
post-React framework have all converged foundational ideas:
1. Using reactivity for DOM updates
2. Using cloned templates for DOM rendering
3. Using modern web APIs like `<template>` and `Proxy`, which make all of the above easier

# pull-based 和 push-based 的区别

React 更像是 pull-based 的框架，这是因为 React 的更新模型是基于拉取数据的方式：
  1. 虚拟 DOM 的重建：在 React 中，当组件的状态发生变化时，React 会假设整个虚拟 DOM 树需要从头开始重新构建。
     这意味着 React 会主动检查组件的状态并根据需要更新 DOM，而不是被动地接收推送的变化。这种拉取数据的方式使 React 能够灵活地控制更新过程。
  2. React.memo 和 shouldComponentUpdate：为了避免不必要的更新，React 提供了 React.memo（函数组件）和 shouldComponentUpdate（类组件）等机制。
     这些机制允许开发人员显式地告诉 React 哪些组件应该进行浅比较，以确定是否需要进行更新。
     这种显式的优化方式更符合拉取数据的思想，因为组件需要主动拉取更新的决策。

相反，现代框架使用基于推送的响应式模型。在这个模型中，组件树的各个部分订阅状态更新，并且仅在相关状态发生变化时才更新 DOM。
这种模型以 “默认高性能” 的设计为重点，但需要一些额外的前期工作（尤其是内存方面）来跟踪哪些状态部分与 UI 的哪些部分相关联。

# cloning DOM trees

传统方式下，我们会通过 innerHTML 的方式去创建 DOM tree，就像这样：

```js
const container = document.createElement('div')
container.innerHTML = `
  <div class="blue">Blue!</div>
`
```

这种方式存在的问题：

1. 更新 DOM trees 时，会完全移除 DOM 再创建，效率很低
2. 会导致状态丢失，比如 input 的 value 在更新时会重置

更推荐的方式是使用 `<template>`，就像这样：

```js
const template = document.createElement('template')
template.innerHTML = `
  <div class="blue">Blue!</div>
`
template.content.cloneNode(true)
```

好处在于：

1. img, video 等标签在这种方式下不会自动加载相应资源，而是等到真正插入到 DOM 时才会加载
2. 速度更快

# 更新 DOM 时如何做到不完全移除 DOM 的状态
*/

/**
 * 1. 响应式系统
 *
 * dream code
 *
 * ```js
 * const state = {}
 *
 * state.foo = 1
 * state.bar = 2
 *
 * // state.foo 或 state.bar 更新时都会自动更新 state.sum
 * useEffect(() => {
 *   state.sum = state.foo + state.bar
 * })
 *
 * state.sum === 3 // true
 *
 * state.foo = 2
 * state.sum === 4 // true
 *
 * state.bar = 3
 * state.sum === 5 // true
 * ```
 */
function reactiveSystem() {
  /** 用于记录 propertyKey 与 effects 的映射关系，方便在 set 的时候找到相应的 effect 去执行 */
  const propertyKeyToEffectsMap = new Map()

  /** 记录当前正在执行的 effect */
  let currentEffect = null

  const useEffect = (effect) => {
    currentEffect = effect
    effect()
    currentEffect = null
  }

  /**
   * 需要建立 propertyKey 与 effect 的映射关系
   */
  const createOnGet = () => {
    return (propertyKey) => {
      if (!propertyKeyToEffectsMap.has(propertyKey)) {
        propertyKeyToEffectsMap.set(propertyKey, [])
      }

      const effects = propertyKeyToEffectsMap.get(propertyKey)

      if (typeof currentEffect === 'function') {
        effects.push(currentEffect)
      }
    }
  }

  /**
   * 引入微任务的目的：合并更新，比如 state.foo 和 state.bar 连续变化，那么会导致 state.sum 的计算重复执行多次
   * 但其实只需要在 state.foo 和 state.bar 更新完后取最后的结果来计算 state.sum 即可
   *
   * set 的时候获取该 propertyKey 的所有 effects，记录下来，等到微任务中的 flush 执行时依次执行 effect
   */
  const createOnSet = () => {
    /** 用于记录需要合并更新的 effects */
    const effectsForFlush = []

    let queued = false

    const flush = () => {
      // 依次取出 effect 执行
      for (const effect of effectsForFlush) {
        effect()
      }

      // 执行完后清空数组
      effectsForFlush.length = 0
    }

    return (propertyKey, newValue) => {
      if (propertyKeyToEffectsMap.has(propertyKey)) {
        const effects = propertyKeyToEffectsMap.get(propertyKey)

        effectsForFlush.push(...effects)

        // propertyKey 有 effects 时才有必要创建微任务去 flush
        if (!queued) {
          queued = true
          queueMicrotask(() => {
            queued = false
            flush()
          })
        }
      }
    }
  }

  const onGet = createOnGet()
  const onSet = createOnSet()

  // 通过 Proxy 在 get 时收集依赖（即 createEffect 内传入的回调），set 时触发依赖可以实现
  const rawState = {}
  const state = new Proxy(rawState, {
    get(target, propertyKey, receiver) {
      onGet(propertyKey)

      return Reflect.get(target, propertyKey, receiver)
    },

    set(target, propertyKey, newValue, receiver) {
      onSet(propertyKey, newValue)

      return Reflect.set(target, propertyKey, newValue, receiver)
    },
  })

  return {
    state,
    useEffect,
  }
}

/**
 * 2. DOM Rendering
 *
 * 目标：传入一个状态，，要做到以下两点：
 * 1. 根据这个状态构建 DOM 树
 * 2. 高效更新 DOM 树
 *
 * dream code
 *
 * ```js
 * function render(state) {
 *   return html`
 *     <div class="${state.color}">${state.text}</div>
 *   `
 * }
 * ```
 */
function domRendering() {
  const tokensToTemplates = new WeakMap()

  function transformHTMLStringToTemplate(htmlString) {
    const template = document.createElement('template')
    template.innerHTML = htmlString

    return template
  }

  function replaceStubs(stringWithStubs, valueOfStubs) {
    return stringWithStubs.replace(/__stub-(\d+)__/g, (_, index) => valueOfStubs[index])
  }

  function html(tokens, ...expressions) {
    let templateWithStubs = tokensToTemplates.get(tokens)

    if (!templateWithStubs) {
      const stubs = expressions.map((_, index) => `__stub-${index}__`)
      const tokensWithStubs = tokens.map((token, index) => (stubs[index - 1] ?? '') + token)
      const htmlStringWithStubs = tokensWithStubs.join('')

      templateWithStubs = transformHTMLStringToTemplate(htmlStringWithStubs)
      tokensToTemplates.set(tokens, templateWithStubs)
    }

    const clonedNodeWithStubs = templateWithStubs.content.cloneNode(true)
    const element = clonedNodeWithStubs.firstElementChild

    // 替换属性中的 stubs
    for (const { name, value } of element.attributes) {
      element.setAttribute(name, replaceStubs(value, expressions))
    }

    // 替换 textContent 中的 stubs
    element.textContent = replaceStubs(element.textContent, expressions)

    return element
  }

  function render(state) {
    return html`<div class="${state.color}">${state.text}</div>`
  }

  return {
    render,
  }
}

function runDemo() {
  const reactiveSystemDemo = () => {
    const { state, useEffect } = reactiveSystem()

    state.foo = 1
    state.bar = 2

    useEffect(() => {
      state.sum = state.foo + state.bar
    })

    console.log(state.sum === 3)

    state.foo = 2
    Promise.resolve().then(() => {
      console.log(state.sum === 4)

      state.bar = 3
      Promise.resolve().then(() => {
        console.log(state.sum === 5)
      })
    })

    setTimeout(() => {
      state.foo = 4
      state.bar = 4
      console.log(state.sum === 5)
      Promise.resolve().then(() => {
        console.log(state.sum === 8)
      })
    })
  }

  const domRenderingDemo = () => {
    const { render } = domRendering()

    const app = document.querySelector('#app')
    app.appendChild(render({ color: 'red', text: 'Red' }))
    app.appendChild(render({ color: 'blue', text: 'Blue' }))
  }

  reactiveSystemDemo()
  domRenderingDemo()
}

/**
 * 3. 组合响应式系统 & DOM Rendering
 */
function combiningReactiveSystemAndDOMRendering() {
  const { state, useEffect } = reactiveSystem()
  const { render } = domRendering()

  const app = document.querySelector('#app')

  state.color = 'blue'
  state.count = 0

  useEffect(() => {
    console.log('rendering', state)
    const dom = render(state)

    if (app.firstElementChild) {
      app.firstElementChild.replaceWith(dom)
    } else {
      app.appendChild(dom)
    }
  })

  useEffect(() => {
    state.text = `${state.count}`
  })

  setInterval(() => {
    state.count++
  }, 1000)
}

function main() {
  // runDemo()

  combiningReactiveSystemAndDOMRendering()
}

main()
