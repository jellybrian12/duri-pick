BEGIN;

-- 대상 지역이 아직 없다면 기존 행의 ID를 유지하면서 이름과 slug만 바꾼다.
UPDATE "regions" AS legacy
SET "slug" = target."new_slug", "name" = target."name"
FROM (VALUES
    ('ikseon-dong', 'jongno-euljiro', '종로~을지로'),
    ('haebangchon', 'yongsan', '용산')
) AS target("old_slug", "new_slug", "name")
WHERE legacy."slug" = target."old_slug"
  AND NOT EXISTS (
      SELECT 1 FROM "regions" AS existing WHERE existing."slug" = target."new_slug"
  );

-- 두 지역 행이 모두 있으면 기존 장소부터 대상 지역으로 옮겨 FK를 유지한다.
UPDATE "places" AS place
SET "region_id" = destination."id", "updated_at" = CURRENT_TIMESTAMP
FROM (VALUES ('ikseon-dong', 'jongno-euljiro'), ('haebangchon', 'yongsan'))
    AS target("old_slug", "new_slug")
JOIN "regions" AS legacy ON legacy."slug" = target."old_slug"
JOIN "regions" AS destination ON destination."slug" = target."new_slug"
WHERE place."region_id" = legacy."id";

DELETE FROM "regions" WHERE "slug" IN ('ikseon-dong', 'haebangchon');

-- 초기 시드와 기존 DB에서 첫 출시 지역의 노출 순서를 맞춘다.
UPDATE "regions" AS region
SET "sort_order" = target."sort_order"
FROM (VALUES
    ('yongsan', 0),
    ('seongsu-seoul-forest', 1),
    ('yeonnam', 2),
    ('jongno-euljiro', 3),
    ('seochon', 4),
    ('bukchon', 5)
) AS target("slug", "sort_order")
WHERE region."slug" = target."slug";

COMMIT;
