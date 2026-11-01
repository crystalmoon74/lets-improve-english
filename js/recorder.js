// Thin MediaRecorder wrapper that works on desktop Chrome/Edge/Firefox,
// Android Chrome (webm/opus) and iOS Safari 14.3+ (mp4/aac).
const CANDIDATE_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/aac'];

export function recordingSupported() {
  return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export function unsupportedReason() {
  if (!window.isSecureContext) return '녹음은 HTTPS 또는 localhost에서만 사용할 수 있어요.';
  return '이 브라우저는 녹음을 지원하지 않아요. 최신 Chrome 또는 Safari를 사용해 주세요.';
}

function pickMimeType() {
  if (!MediaRecorder.isTypeSupported) return '';
  return CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  const startedAt = Date.now();
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start(1000);

  return {
    startedAt,
    stop: () =>
      new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const type = recorder.mimeType || mimeType || 'audio/webm';
          resolve({ blob: new Blob(chunks, { type }), mime: type, duration: (Date.now() - startedAt) / 1000, createdAt: Date.now() });
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

export function extensionFor(mime) {
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}
