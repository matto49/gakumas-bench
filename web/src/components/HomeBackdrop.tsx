/** 首页头图以下的底：铺满整个视口宽度，垫在内容后面，内容卡片仍是白底。
 * 暖白底 + 一层细网点。11-18 去掉了 Vo / Da / Vi 三团彩色光斑（渐变色），不要再加回来 */
export function HomeBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden bg-[#F7F4F0]" aria-hidden>
      <div className="absolute inset-0 [background-image:radial-gradient(rgba(60,40,30,.07)_1px,transparent_1.2px)] [background-size:18px_18px]" />
    </div>
  )
}
