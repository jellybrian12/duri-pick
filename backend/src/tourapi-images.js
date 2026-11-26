const imagePageSize = 20
const restrictedTypes = new Set(['Type2', 'Type3', 'Type4'])

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function publicUrl(value) {
  try {
    const url = new URL(text(value))
    if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
        ![...url.searchParams.keys()].some(key => key.toLowerCase() === 'servicekey')) {
      return url.href
    }
  } catch {
    // URL이 없거나 형식이 잘못된 사진은 사용 근거와 연결할 수 없다.
  }
  return null
}

function attributionKey(contentId, serialNumber) {
  return contentId + ':' + serialNumber
}

export function parsePhotoAttributions(entries) {
  if (!Array.isArray(entries)) throw new Error('Photo attributions must be a JSON array.')

  const attributions = new Map()
  for (const entry of entries) {
    const contentId = text(entry?.contentId)
    const serialNumber = text(entry?.serialNumber)
    const imageUrl = publicUrl(entry?.imageUrl)
    const sourceUrl = publicUrl(entry?.sourceUrl)
    const attributionText = text(entry?.attributionText)
    const key = attributionKey(contentId, serialNumber)
    if (!/^\d+$/.test(contentId) || !serialNumber || !imageUrl || !sourceUrl ||
        !attributionText || attributions.has(key)) {
      throw new Error('Each photo needs a unique ID pair, image URL, source URL and verified attribution.')
    }
    attributions.set(key, { imageUrl, sourceUrl, attributionText })
  }
  return attributions
}

export async function fetchTourApiPhotos(request, contentId) {
  const rows = []
  let total
  for (let page = 1; ; page++) {
    const result = await request('detailImage2', {
      contentId,
      imageYN: 'Y',
      numOfRows: String(imagePageSize),
      pageNo: String(page),
    })
    if (result.error) return result

    total ??= result.total
    const expected = Math.min(imagePageSize, total - rows.length)
    if (result.total !== total || result.rows.length !== expected ||
        result.rows.some(row => text(row?.contentid) !== contentId)) {
      // 일부 페이지에서만 확인한 사진 정보로 기존 사진을 갱신하지 않는다.
      return { error: 'incomplete_photo_response' }
    }
    rows.push(...result.rows)
    if (rows.length === total) return { rows }
  }
}

export async function photoIdsForReview(prisma, placeId) {
  if (!placeId) return []
  const photos = await prisma.placeImage.findMany({
    where: { placeId, provider: 'tourapi' },
    select: { id: true },
  })
  return photos.map(({ id }) => id)
}

export async function syncTourApiPhotos(db, { apply, placeId, contentId, rows, attributions }) {
  const savedImages = placeId
    ? await db.placeImage.findMany({ where: { placeId } })
    : []
  const savedByUrl = new Map()
  for (const image of savedImages) {
    if (image.provider !== 'tourapi') continue
    const imageUrl = publicUrl(image.imageUrl)
    const matching = savedByUrl.get(imageUrl) ?? []
    matching.push(image)
    savedByUrl.set(imageUrl, matching)
  }
  let sortOrder = Math.max(-1, ...savedImages.map(image => image.sortOrder)) + 1

  const observed = new Map()
  for (const row of rows) {
    const imageUrl = publicUrl(row.originimgurl) ?? publicUrl(row.smallimageurl)
    if (!imageUrl) continue
    const type = text(row.cpyrhtDivCd)
    const serialNumber = text(row.serialnum)
    const previous = observed.get(imageUrl)
    // 같은 URL에 서로 다른 권리 정보가 있으면 자동으로 공개하지 않는다.
    if (previous && (previous.type !== type || previous.serialNumber !== serialNumber)) {
      observed.set(imageUrl, { type: '', serialNumber: '', altText: '' })
    } else if (!previous) {
      observed.set(imageUrl, { type, serialNumber, altText: text(row.imgname) })
    }
  }

  const report = { approved: 0, restricted: 0, pendingAttribution: [], existingPhotoIdsForReview: [] }
  for (const [imageUrl, { type, serialNumber, altText }] of observed) {
    const matches = savedByUrl.get(imageUrl) ?? []
    const existing = matches[0]
    if (restrictedTypes.has(type)) {
      report.restricted++
      // 제한 유형이 확인된 기존 사진은 행과 출처를 보존하고 공개 대상에서 제외한다.
      const ids = matches.filter(image => image.licenseCode !== type).map(image => image.id)
      if (apply && ids.length) {
        await db.placeImage.updateMany({ where: { id: { in: ids } }, data: { licenseCode: type } })
      }
      continue
    }

    if (type !== 'Type1') {
      report.existingPhotoIdsForReview.push(...matches.map(image => image.id))
      continue
    }

    const proof = attributions.get(attributionKey(contentId, serialNumber))
    if (!proof || proof.imageUrl !== imageUrl) {
      if (existing?.licenseCode !== 'Type1' || !publicUrl(existing.sourceUrl) ||
          !text(existing.attributionText) || !text(existing.usageBasis)) {
        report.pendingAttribution.push({ serialNumber: serialNumber || null, imageUrl })
        if (existing) report.existingPhotoIdsForReview.push(existing.id)
      }
      continue
    }

    const data = {
      imageUrl,
      altText: altText || '장소 사진',
      provider: 'tourapi',
      licenseCode: 'Type1',
      sourceUrl: proof.sourceUrl,
      attributionText: proof.attributionText,
      usageBasis: 'TourAPI detailImage2 공공누리 제1유형, 사진 번호 ' + serialNumber,
    }
    if (apply) {
      if (existing) {
        await db.placeImage.update({ where: { id: existing.id }, data })
      } else {
        await db.placeImage.create({ data: { ...data, placeId, sortOrder } })
      }
    }
    if (!existing) sortOrder++
    report.approved++
  }

  // 응답에서 빠진 기존 사진은 자동 삭제하지 않고 출처를 다시 확인할 목록에 넣는다.
  for (const [imageUrl, matches] of savedByUrl) {
    if (!observed.has(imageUrl)) report.existingPhotoIdsForReview.push(...matches.map(image => image.id))
  }
  return report
}
