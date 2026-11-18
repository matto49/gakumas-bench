/** 首页头图以下的底：铺满整个视口宽度，垫在内容后面，内容卡片仍是白底。
 * 暖白底 + 一层细网点 + Vo 粉、Da 蓝、Vi 黄三团很淡的光斑（左上、右中、左下），不依赖卡面 */
export function HomeBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden bg-[#F7F4F0]" aria-hidden>
      <div className="absolute inset-0 [background-image:radial-gradient(rgba(60,40,30,.07)_1px,transparent_1.2px)] [background-size:18px_18px]" />
      <div className="absolute top-[120px] -left-[200px] size-[640px] rounded-full bg-vo opacity-[.13] blur-[120px]" />
      <div className="absolute top-[900px] -right-[220px] size-[680px] rounded-full bg-da opacity-[.12] blur-[120px]" />
      <div className="absolute bottom-[200px] -left-[160px] size-[600px] rounded-full bg-vi opacity-[.16] blur-[120px]" />
    </div>
  )
}
