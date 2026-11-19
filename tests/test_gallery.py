"""图鉴数据：每个角色的立绘、偶像卡卡面（按导出了的图标出有哪几套）、相关支援卡、衣装、发型，中日文；没导出图的不列"""
import json

import pytest

yaml = pytest.importorskip("yaml")
from gkbench.gallery import build  # noqa: E402


def write(dir, name, rows):
    (dir / f"{name}.yaml").write_text(yaml.safe_dump(rows, allow_unicode=True), encoding="utf-8")


def zh(dir, name, rows):
    (dir / f"{name}.json").write_text(json.dumps({"rules": {}, "data": rows}, ensure_ascii=False), encoding="utf-8")


def touch(img, *paths):
    for p in paths:
        f = img / p
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x")


@pytest.fixture
def world(tmp_path):
    m, t, img = tmp_path / "m", tmp_path / "t", tmp_path / "img"
    for d in (m, t, img):
        d.mkdir()
    write(m, "Character", [{"id": "shro", "lastName": "篠澤", "firstName": "広"}, {"id": "hski", "lastName": "花海", "firstName": "咲季"},
                           {"id": "nasr", "lastName": "根緒", "firstName": "亜紗里"}])
    write(m, "IdolCard", [
        {"id": "i_card-shro-3-016", "characterId": "shro", "assetId": "cidol-shro-3-016", "name": "みちなるひろがる", "rarity": "IdolCardRarity_Ssr", "order": "2"},
        {"id": "i_card-shro-1-000", "characterId": "shro", "assetId": "cidol-shro-1-000", "name": "学園生活", "rarity": "IdolCardRarity_R", "order": "1"},
        {"id": "i_card-hski-3-001", "characterId": "hski", "assetId": "cidol-hski-3-001", "name": "まだ", "rarity": "IdolCardRarity_Ssr", "order": "3"}])
    write(m, "IdolCardSkin", [
        {"id": "i_card-skin-shro-3-016", "idolCardId": "i_card-shro-3-016", "name": "", "assetId": "cidol-shro-3-016", "order": "20"},
        {"id": "i_card-skin-shro-1-000", "idolCardId": "i_card-shro-1-000", "name": "", "assetId": "cidol-shro-1-000", "order": "10"},
        {"id": "i_card-skin-shro-3-020", "idolCardId": "i_card-shro-3-016", "name": "'25祭", "assetId": "cidol-shro-3-020", "order": "30"},
        {"id": "i_card-skin-hski-3-001", "idolCardId": "i_card-hski-3-001", "name": "", "assetId": "cidol-hski-3-001", "order": "40"}])
    zh(t, "IdolCardSkin", [{"id": "i_card-skin-shro-3-020", "name": "'25祭典"}])
    write(m, "Costume", [
        {"id": "shro-cstm-0119", "characterId": "shro", "name": "古今東西", "description": "【光景】を入手", "targetId": "i_card-skin-shro-3-016", "order": 2},
        {"id": "shro-schl-0000", "characterId": "shro", "name": "制服", "description": "最初から所持", "targetId": "", "order": 1},
        {"id": "shro-cstm-9999", "characterId": "shro", "name": "未実装", "description": "", "targetId": "", "order": 3}])
    write(m, "CostumeHead", [{"id": "costume_head_shro-hair-0001", "characterId": "shro", "name": "いつもの髪型", "description": "最初から所持", "order": 1}])
    zh(t, "Character", [{"id": "shro", "lastName": "篠泽", "firstName": "广"}])
    zh(t, "IdolCard", [{"id": "i_card-shro-3-016", "name": "未知万千 广阔无限"}])
    zh(t, "Costume", [{"id": "shro-cstm-0119", "name": "古今东西", "description": "获得【光景】"}])
    zh(t, "CostumeHead", [{"id": "costume_head_shro-hair-0001", "name": "日常发型", "description": "初始持有"}])
    supports = {"cards": {"s_card-3-0001": {"name": {"ja": "サポ", "zh": "支援"}, "rarity": "SSR", "characters": ["shro", "hski"]},
                          "s_card-1-0002": {"name": {"ja": "なし"}, "rarity": "R", "characters": []}}}
    touch(img, "chr/shro-full.webp", "chr/shro-bustup.webp", "chr/hski-bustup.webp",
          "card/cidol-shro-3-016_0.webp", "card/cidol-shro-3-016_1.webp", "card/cidol-shro-3-016_2.webp", "card/cidol-shro-1-000_1.webp",
          "card/cidol-shro-3-020_0.webp", "card/cidol-shro-3-020_1.webp",
          "support/s_card-3-0001.webp", "support/s_card-1-0002.webp",
          "cos/shro-cstm-0119.webp", "cos/shro-schl-0000.webp", "head/costume_head_shro-hair-0001.webp")
    return m, t, img, supports


def test_characters_and_cards(world):
    m, t, img, supports = world
    g = build(m, t, img, supports)
    chars = {c["id"]: c for c in g["characters"]}
    # 没有任何图的角色（nasr）不列；有图的带立绘有无
    assert set(chars) == {"shro", "hski"}
    assert chars["shro"] == {"id": "shro", "name": {"ja": "篠澤広", "zh": "篠泽广"}, "stand": True, "bustup": True}
    assert chars["hski"]["stand"] is False and chars["hski"]["bustup"] is True
    # 一套卡面一条（偶像卡本身的卡面 + 「光景」换装卡面），按卡面表的 order 排
    cards = {c["id"]: c for c in g["cards"]}
    assert cards["i_card-skin-shro-3-016"] == {"id": "i_card-skin-shro-3-016", "card": "i_card-shro-3-016", "char": "shro", "asset": "cidol-shro-3-016",
                                               "rarity": "SSR", "name": {"ja": "みちなるひろがる", "zh": "未知万千 广阔无限"}, "arts": [0, 1, 2]}
    assert cards["i_card-skin-shro-3-020"]["skin"] == {"ja": "'25祭", "zh": "'25祭典"}
    assert cards["i_card-skin-shro-3-020"]["card"] == "i_card-shro-3-016" and cards["i_card-skin-shro-3-020"]["arts"] == [0, 1]
    assert "skin" not in cards["i_card-skin-shro-3-016"]
    assert cards["i_card-skin-shro-1-000"]["arts"] == [1]  # 只导出了特训后
    assert "i_card-skin-hski-3-001" not in cards  # 一张图都没有的不列
    assert [c["id"] for c in g["cards"]] == ["i_card-skin-shro-1-000", "i_card-skin-shro-3-016", "i_card-skin-shro-3-020"]


def test_supports_costumes_heads(world):
    m, t, img, supports = world
    g = build(m, t, img, supports)
    assert g["supports"] == [{"id": "s_card-3-0001", "rarity": "SSR", "name": {"ja": "サポ", "zh": "支援"}, "chars": ["shro", "hski"]},
                             {"id": "s_card-1-0002", "rarity": "R", "name": {"ja": "なし"}, "chars": []}]
    cos = {c["id"]: c for c in g["costumes"]}
    assert set(cos) == {"shro-cstm-0119", "shro-schl-0000"}  # 没导出图的衣装不列
    assert cos["shro-cstm-0119"] == {"id": "shro-cstm-0119", "char": "shro", "name": {"ja": "古今東西", "zh": "古今东西"},
                                     "desc": {"ja": "【光景】を入手", "zh": "获得【光景】"}, "skin": "i_card-skin-shro-3-016"}
    assert "skin" not in cos["shro-schl-0000"]
    assert [c["id"] for c in g["costumes"]] == ["shro-schl-0000", "shro-cstm-0119"]
    assert g["heads"] == [{"id": "costume_head_shro-hair-0001", "char": "shro", "name": {"ja": "いつもの髪型", "zh": "日常发型"},
                           "desc": {"ja": "最初から所持", "zh": "初始持有"}}]
