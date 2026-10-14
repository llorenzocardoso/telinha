// Picture-quality metrics for a received frame against the reference it was shared from.
// The comparison runs inside a page (canvas), so it works on any <video> element.
//
//   const result = await measureFrame(page, "video", refPngBase64);
//   -> { width, height, psnr, psnrLuma, ssim, scaledFrom }
//
// PSNR is computed on RGB and on luma; SSIM on luma over 8x8 blocks (the classic simplified form).
// A frame whose size differs from the reference is scaled to it first (and reported).

export async function measureFrame(page, videoSelector, referencePngBase64) {
  return page.evaluate(
    async ({ selector, reference }) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });
      const ref = await load(`data:image/png;base64,${reference}`);
      const video = document.querySelector(selector);
      if (!video || !video.videoWidth) throw new Error("no video frame to measure");

      const draw = (source, width, height) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(source, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height).data;
      };
      const width = ref.naturalWidth;
      const height = ref.naturalHeight;
      const a = draw(ref, width, height);
      const b = draw(video, width, height);
      const scaledFrom =
        video.videoWidth === width && video.videoHeight === height
          ? null
          : `${video.videoWidth}x${video.videoHeight}`;

      let sse = 0;
      let sseLuma = 0;
      const lumaA = new Float64Array(width * height);
      const lumaB = new Float64Array(width * height);
      for (let i = 0, p = 0; i < a.length; i += 4, p++) {
        for (let c = 0; c < 3; c++) {
          const d = a[i + c] - b[i + c];
          sse += d * d;
        }
        lumaA[p] = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
        lumaB[p] = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
        const dl = lumaA[p] - lumaB[p];
        sseLuma += dl * dl;
      }
      const psnr = (mse) => (mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse));
      const mse = sse / (width * height * 3);
      const mseLuma = sseLuma / (width * height);

      const c1 = (0.01 * 255) ** 2;
      const c2 = (0.03 * 255) ** 2;
      let ssimSum = 0;
      let blocks = 0;
      for (let by = 0; by + 8 <= height; by += 8) {
        for (let bx = 0; bx + 8 <= width; bx += 8) {
          let ma = 0;
          let mb = 0;
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const p = (by + y) * width + bx + x;
              ma += lumaA[p];
              mb += lumaB[p];
            }
          }
          ma /= 64;
          mb /= 64;
          let va = 0;
          let vb = 0;
          let cov = 0;
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const p = (by + y) * width + bx + x;
              va += (lumaA[p] - ma) ** 2;
              vb += (lumaB[p] - mb) ** 2;
              cov += (lumaA[p] - ma) * (lumaB[p] - mb);
            }
          }
          va /= 63;
          vb /= 63;
          cov /= 63;
          ssimSum += ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2));
          blocks++;
        }
      }
      return {
        width,
        height,
        psnr: +psnr(mse).toFixed(2),
        psnrLuma: +psnr(mseLuma).toFixed(2),
        ssim: +(ssimSum / blocks).toFixed(4),
        scaledFrom,
      };
    },
    { selector: videoSelector, reference: referencePngBase64 },
  );
}
