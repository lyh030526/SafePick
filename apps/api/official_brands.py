from dataclasses import dataclass


@dataclass(frozen=True)
class OfficialBrand:
    name: str
    domains: tuple[str, ...]
    aliases: tuple[str, ...]
    search_sites: tuple[str, ...] = ()


OFFICIAL_BRANDS: tuple[OfficialBrand, ...] = (
    OfficialBrand("삼성전자", ("samsung.com",), ("삼성", "Samsung", "Samsung Electronics"), ("samsung.com/sec",)),
    OfficialBrand("Apple", ("apple.com",), ("애플",), ("apple.com/kr",)),
    OfficialBrand("LG전자", ("lge.co.kr",), ("LG", "LG Electronics")),
    OfficialBrand("다이슨", ("dyson.co.kr", "dyson.com"), ("Dyson",), ("dyson.co.kr",)),
    OfficialBrand("소니", ("sony.co.kr", "sony.com"), ("Sony", "소니코리아"), ("sony.co.kr",)),
)


def find_official_brand(brand_name: str) -> OfficialBrand | None:
    normalized = brand_name.strip().casefold()
    if not normalized:
        return None

    for brand in OFFICIAL_BRANDS:
        candidates = (brand.name, *brand.aliases)
        if any(normalized == candidate.casefold() for candidate in candidates):
            return brand
    return None
