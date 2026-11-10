// 官方 AI 的触发效果预测要「在当前局面上单独执行一条效果」：GKMS 原生核心没有这个接口，这里补一个。
// 整个核心按原样编进来（#include api.cpp，同一份头文件、同样的编译选项），所以 Core 的内存布局和 libgkmscore 一致，
// 可以直接操作 NativeExamSession 持有的核心指针（调用方传的是一份克隆）。
//
// bx_apply_effect：按触发效果的口径执行一条效果——间接效果（indirect_depth + 1）、关掉触发命令、
// 不派发后续触发事件（各阶段监听表清零）、不写绑定日志；执行完恢复这几样。返回 0 成功，1 核心不支持，3 没有这条效果。
#include "api.cpp"

extern "C" {
GK_API int bx_core_size(void) { return (int)sizeof(Core); }
GK_API int bx_state_size(void) { return (int)sizeof(GkmsState); }

GK_API int bx_apply_effect(void *core, int32_t effect_sid) {
    Core *c = (Core *)core;
    const Eff *e = eff_ptr(c, effect_sid);
    if (!e) return 3;
    uint64_t saved[64];
    memcpy(saved, c->phase_candidates, sizeof saved);
    memset(c->phase_candidates, 0, sizeof saved);
    BindLog *blog = c->blog;
    c->blog = NULL;
    int gate = gate_open(c, 0);
    c->indirect_depth += 1;
    int64_t permil = parameter_permil(c);
    apply_effect(c, e, permil);
    c->indirect_depth -= 1;
    gate_close(c, gate);
    c->blog = blog;
    memcpy(c->phase_candidates, saved, sizeof saved);
    return c->unsup ? 1 : 0;
}
}
