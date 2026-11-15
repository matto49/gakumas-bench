/* seed_scan.c -- the exam seeds whose opening shuffle agrees with what a screen has shown (UIHorizon, SX-05).
 *
 * The same model as GKMSProject GakumasCLI/tools/seed_solver.c (xorshift32(13,17,5) seeded with the exam seed; the
 * turn attributes are the first calls; k calls precede the shuffle; Fisher-Yates from the back; draws from the
 * front), with one more rule for what a screen really shows: some deck cards leave the draw pile without being
 * drawn (the exam places them in the opening hand, or an effect removes them later).  They are given as ``skip``.
 * A seed matches when its shuffled order, read from the front, gives the observed draws in order once skip cards
 * are passed over; a card that is both a skip card and the next observed card may be either.
 *
 * usage: seed_scan <k> <pre ids> <observed ids> <skip ids or -> <lo> <hi> [<pool> <turns>]
 *   ids: small integers naming card ids, comma separated; pool / turns: the attribute pool and the attributes seen
 *   ("-" or nothing: no attribute filter).  Prints one matching seed per line, then "# done <scanned> <found>".
 * build: gcc -O3 seed_scan.c -o seed_scan      (one thread; the caller runs one process per range)
 */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static inline uint32_t xs(uint32_t s) { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s; }

static int parse_list(const char *text, int *out, int cap) {
    int n = 0; const char *p = text;
    if (!strcmp(text, "-")) return 0;
    while (*p && n < cap) { out[n++] = (int)strtol(p, (char **)&p, 10); if (*p == ',') p++; }
    return n;
}

static int n, L, pre[64], obs[64];
static uint8_t idx[65];

static inline int card_at(int p) {                       /* the card id at front position p of the shuffled deck */
    int q = p;
    for (int size = 2; size <= n; size++) { int j = idx[size]; if (q == size - 1) q = j; else if (q == j) q = size - 1; }
    return pre[q];
}

static int match(int p, int m, int *skip) {              /* positions from p on give obs[m..] with skips allowed */
    while (m < L) {
        if (p >= n) return 0;
        int c = card_at(p);
        if (skip[c] > 0) {
            if (c == obs[m] && match(p + 1, m + 1, skip)) return 1;    /* drawn, not skipped */
            skip[c]--;
            int r = match(p + 1, m, skip);
            skip[c]++;
            return r;
        }
        if (c != obs[m]) return 0;
        p++; m++;
    }
    return 1;
}

int main(int argc, char **argv) {
    if (argc < 7) { fprintf(stderr, "usage: %s k pre obs skip lo hi [pool turns]\n", argv[0]); return 2; }
    int k = atoi(argv[1]);
    int sk[64], skip[256];
    n = parse_list(argv[2], pre, 64);
    L = parse_list(argv[3], obs, 64);
    int S = parse_list(argv[4], sk, 64);
    uint64_t lo = strtoull(argv[5], 0, 10), hi = strtoull(argv[6], 0, 10);
    if (n < 2 || n > 64 || L < 1 || L > n) { fprintf(stderr, "bad sizes\n"); return 2; }
    memset(skip, 0, sizeof skip);
    for (int i = 0; i < n; i++) if (pre[i] < 0 || pre[i] > 255) { fprintf(stderr, "bad id\n"); return 2; }
    for (int i = 0; i < S; i++) skip[sk[i] & 255]++;
    int pool[32], turns[32], P = 0, M = 0;
    if (argc > 8 && strcmp(argv[7], "-") != 0) {
        P = parse_list(argv[7], pool, 32);
        M = parse_list(argv[8], turns, 32);
        if (M > P) { fprintf(stderr, "more turns than pool entries\n"); return 2; }
    }
    static uint32_t T[4][256];                           /* the state after k calls, by seed byte */
    for (int b = 0; b < 4; b++)
        for (int v = 0; v < 256; v++) {
            uint32_t s = (uint32_t)v << (8 * b);
            for (int i = 0; i < k; i++) s = xs(s);
            T[b][v] = s;
        }
    long long found = 0;
    for (uint64_t seed = lo; seed < hi; seed++) {
        uint32_t x = (uint32_t)seed;
        if (M) {
            int left[32], len = P, ok = 1;
            uint32_t t = x;
            memcpy(left, pool, sizeof(int) * (size_t)P);
            for (int i = 0; i < M; i++) {
                int j = (int)(((uint64_t)t * (uint32_t)len) >> 32);
                t = xs(t);
                if (left[j] != turns[i]) { ok = 0; break; }
                memmove(&left[j], &left[j + 1], sizeof(int) * (size_t)(len - j - 1));
                len--;
            }
            if (!ok) continue;
        }
        uint32_t s = T[0][x & 255] ^ T[1][(x >> 8) & 255] ^ T[2][(x >> 16) & 255] ^ T[3][x >> 24];
        for (int size = n; size >= 2; size--) { idx[size] = (uint8_t)(((uint64_t)s * (uint32_t)size) >> 32); s = xs(s); }
        if (match(0, 0, skip)) { found++; printf("%llu\n", (unsigned long long)seed); }
    }
    printf("# done %llu %lld\n", (unsigned long long)(hi - lo), found);
    return 0;
}
