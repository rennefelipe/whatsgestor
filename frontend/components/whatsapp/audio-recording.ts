export const MAX_AUDIO_RECORDING_BYTES = 16 * 1024 * 1024;
export const MAX_AUDIO_RECORDING_MS = 5 * 60 * 1000;

export interface AudioRecordingFormat {
  mimeType: string;
  extension: "webm" | "ogg" | "mp4";
}

export const AUDIO_RECORDING_FORMATS: readonly AudioRecordingFormat[] = [
  { mimeType: "audio/webm;codecs=opus", extension: "webm" },
  { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
  { mimeType: "audio/mp4", extension: "mp4" },
];

export function selectAudioRecordingFormat(
  recorder: Pick<typeof MediaRecorder, "isTypeSupported">,
): AudioRecordingFormat | null {
  for (const format of AUDIO_RECORDING_FORMATS) {
    try {
      if (recorder.isTypeSupported(format.mimeType)) return format;
    } catch {
      // A browser with a partial MediaRecorder implementation may throw here.
    }
  }
  return null;
}

export function formatRecordingDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function validateRecordedAudio(recording: {
  size: number;
  durationMs: number;
}): string | null {
  if (!Number.isFinite(recording.size) || recording.size <= 0)
    return "A gravação ficou vazia. Tente novamente.";
  if (recording.size > MAX_AUDIO_RECORDING_BYTES)
    return "O áudio ultrapassou o limite de 16 MB.";
  if (!Number.isFinite(recording.durationMs) || recording.durationMs <= 0)
    return "Não foi possível medir a duração da gravação.";
  if (recording.durationMs > MAX_AUDIO_RECORDING_MS)
    return "O áudio ultrapassou o limite de 5 minutos.";
  return null;
}

export function microphoneErrorMessage(error: unknown): string {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permita o acesso ao microfone no navegador para gravar áudio.";
    case "NotFoundError":
      return "Nenhum microfone foi encontrado neste dispositivo.";
    case "NotReadableError":
    case "AbortError":
      return "O microfone está ocupado ou não pôde ser iniciado.";
    default:
      return "Não foi possível iniciar a gravação de áudio.";
  }
}

export function microphoneCapabilityMessage(capability: {
  secureContext: boolean;
  hasMediaDevices: boolean;
  hasMediaRecorder: boolean;
}): string {
  if (!capability.secureContext)
    return "A gravação exige HTTPS ou acesso pelo localhost.";
  if (!capability.hasMediaDevices)
    return "O navegador não disponibilizou acesso ao microfone nesta página.";
  if (!capability.hasMediaRecorder)
    return "O navegador não oferece gravação de áudio compatível.";
  return "O navegador não aceita WebM, Ogg ou MP4 para esta gravação.";
}
