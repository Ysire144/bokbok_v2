#!/usr/bin/env python3
"""표정 그림 한 장을 게임에 넣을 수 있게 만드는 도구: 배경 제거 + 워터마크 제거 + 가장자리 정리 + 기존 기본 그림과 위치 비교.

사용:
  pip install pillow numpy scipy opencv-python-headless rembg onnxruntime      (처음 한 번)
  python3 tools/expr_cutout.py <받은 그림> <캐릭터> <표정> [기본표정] [--out 폴더]

예: python3 tools/expr_cutout.py ~/수나경멸.webp 수나 경멸 침착
  -> images/characters/수나_경멸.webp 를 만들고, 수나_침착.webp(기본 그림)와 겹쳐서 어긋남을 알려줘.

하는 일 (다른 표정 그림들과 같은 방식):
  1) rembg isnet-anime 으로 배경 마스크 (모델은 처음에 자동으로 내려받음, 약 176MB)
  2) 가장 큰 덩어리만 남김 (오른쪽 아래 ✦ 워터마크 같은 먼지가 같이 지워짐)
  3) 마스크 가장자리를 또렷하게 하고, 가장자리 색을 안쪽 진짜 색으로 바꿔서 하얀 테두리를 없앰
  4) 기본 그림을 같은 크기(1116x2000)로 줄여 겹쳐서 하체 / 몸통의 어긋남(px)을 잼
     - 1.5px 이하면 CHAR 에 아무것도 안 해도 돼.  크면 CHAR 의 adj 로 맞춰야 해 (bokbok27_3.twee 의 CHAR 설명 참고)
  그다음 할 일: CHAR 의 imgs 에 표정 이름을 적고, 장면 글 맨 위에 <span data-bx="캐릭터:표정"></span> 를 넣어.
"""
import sys, os, numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

def smoothstep(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)

def cutout(src, lo=0.40, hi=0.80, blur=0.6):
    from rembg import new_session, remove
    img = Image.open(src).convert('RGB')
    m = np.array(remove(img, session=new_session('isnet-anime'), only_mask=True)).astype(np.float32) / 255.0
    rgb = np.array(img).astype(np.float32)
    b = (m > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(b, connectivity=8)
    big = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    m = m * ndi.binary_dilation(lab == big, iterations=6)
    a = smoothstep(m, lo, hi)
    if blur > 0: a = cv2.GaussianBlur(a, (0, 0), blur)
    solid = ndi.binary_erosion(a > 0.97, iterations=2)
    idx = ndi.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    fill = rgb[idx[0], idx[1]]
    out_rgb = np.where((a < 0.97)[..., None], fill, rgb)
    return Image.fromarray(np.dstack([np.clip(out_rgb, 0, 255), a * 255]).astype(np.uint8), 'RGBA')

def onwhite(im, size=None):
    im = im.convert('RGBA')
    if size: im = im.resize(size, Image.LANCZOS)
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
    return np.array(bg.convert('L')).astype(np.float32)

def shift(new, base, y0, y1):
    warp = np.eye(2, 3, dtype=np.float32)
    cc, warp = cv2.findTransformECC(base[y0:y1], new[y0:y1], warp, cv2.MOTION_TRANSLATION,
                                    (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), None, 5)
    return warp[0, 2], warp[1, 2], cc

def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 3:
        print(__doc__); sys.exit(1)
    src, who, expr = args[:3]
    base_expr = args[3] if len(args) > 3 else None
    outdir = 'images/characters'
    if '--out' in sys.argv: outdir = sys.argv[sys.argv.index('--out') + 1]
    im = cutout(src)
    out = os.path.join(outdir, '%s_%s.webp' % (who, expr))
    if os.path.exists(out): print('이미 있는 파일이라 덮어쓰지 않아:', out, '(다른 이름을 쓰거나 지우고 다시 해)'); sys.exit(1)
    im.save(out, 'WEBP', quality=84, method=6, alpha_quality=100)
    print('저장:', out, im.size, os.path.getsize(out) // 1024, 'KB')
    if base_expr:
        bp = os.path.join(outdir, '%s_%s.webp' % (who, base_expr))
        if not os.path.exists(bp): print('기본 그림이 없어서 위치 비교는 건너뜀:', bp); return
        new = onwhite(im); base = onwhite(Image.open(bp), im.size)
        for (y0, y1, name) in ((1150, 1980, '하체'), (560, 1150, '몸통')):
            dx, dy, cc = shift(new, base, y0, y1)
            print('%s 어긋남: dx=%.2fpx dy=%.2fpx (상관 %.3f, %s)' % (name, dx, dy, cc, '그대로 써도 돼' if max(abs(dx), abs(dy)) <= 1.5 else 'adj 로 맞춰야 해'))

if __name__ == '__main__':
    main()
