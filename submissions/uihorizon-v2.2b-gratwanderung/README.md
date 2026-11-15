# uihorizon-v2-2b-gratwanderung

从画面信息（回合属性、抽到的牌）和公开编成反推这一局的牌序种子；锁定后整局是确定的，于是不再每步重新挑
一个动作，而是让若干提案者各出一条能打到底的完整路线（多个已知牌序的搜索 + GKMSUINet 网络的前瞻），
重放后取终局分最高的一条照着打。只读 `ctx.obs` 和 `ctx.loadout`，不用 `ctx.worlds`，不拿裁判的种子。

`about` 里已经写了 `family = uihorizon`，同一算法的各版本在排行上合成一行。

## 目录

| 路径 | 内容 |
|---|---|
| `algo.py` | 入口，`submission.json` 的 `entry` 指向这里的 `UIHorizon` |
| `vendor/bench/` | 适配器 `uihorizon_bench.py`（`Algorithm` 子类），以及读抽牌、算开局、筛种子、快筛候选的模块 |
| `vendor/bench/seed_scan.c` | 种子扫描内核的源码；第一次用到时用 clang / gcc / cl 现编到临时目录 |
| `vendor/uihorizon/` | 路线池与网络（`pool.py`、`play.py`、`encode.py`） |
| `vendor/uinet/` | GKMSUINet 的推理侧（编码、观测、搜索入口），从 GKMSProject 的 `GKMSUINet/` 原样拷入 |
| `vendor/models/base.onnx` | 基底网络 GKMSUINet G3a（20.7 MB） |

## 对固定评测机的要求

- 本仓库的 Python 环境（numpy / onnxruntime，见 README），不需要额外装包；不联网。
- GKMS 引擎：`GKMS_ROOT` 指向的 GKMSProject 克隆及其原生核心（仓库自己的 `gkbench.engine` 用同一份）。
  种子反推要靠引擎重建对局，所以引擎的考试规则版本要和服务器的 v59 一致；不一致时锁定会大面积失败，
  日志里是 `not locked (...)` / `lost turn N ... differed in: ...`。
- `clang` / `gcc` / `cl` 之一：种子扫描要一个 C 内核（约 4.7 KB 源码，编译一次，缓存在临时目录）。

## 这个目录里改过什么

原包（`UIHorizon-v2.2bPreview-Gratwanderung`）按它自己的布局跑；搬进 `submissions/` 只改了两处：

1. `vendor/bench/seedscan.py`：内核路径从「包目录」改成「临时目录」（评测沙盒只允许写临时目录），
   并把 `clang` 排到 `gcc` 前面——固定评测机是 macOS。
2. `vendor/bench/uihorizon_bench.py`：`MODEL_NAME` 改成 `UIHorizon-v2.2bPreview-Gratwanderung`（这一版的名字）。

`uinet` 是 GKMSProject 里的同名包（MIT），随提交拷入是为了不依赖评测机上的 `GKMSUINet/` 是否在
`GKMS_ROOT` 里；`torch` 只在读 `.pt` 权重时才 import，纯 ONNX 路径不需要它。

## 已测

- Windows / rules 59 引擎：完整一局，`[uihorizon] game 1: locked turn 2; scan 1.5 s, 8986 candidates;
  steps: pool 29, base 3`；同一入口在无预编内核时用 clang 现编内核也能锁定。
- 尚无 macOS 上的实跑：沙盒（`sandbox-exec`）与 Apple silicon 上的原生核心没在这里试过。如果跑不起来，
  请把 `_report()` 打出的那几行（或整段 stderr）贴回 PR，我按那边的报错改。
