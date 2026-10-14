import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function module(file) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    { exports },
  );
  return exports;
}

const audio = module("components/whatsapp/audio-recording.ts");
const attendance = module("components/whatsapp/conversation-attendance.ts");
const presentation = module("components/whatsapp/conversation-presentation.ts");

test("recorder negotiates only a supported real container in the required order", () => {
  const checked = [];
  const selected = audio.selectAudioRecordingFormat({
      isTypeSupported(type) {
        checked.push(type);
        return type === "audio/ogg;codecs=opus";
      },
    });
  assert.equal(selected?.mimeType, "audio/ogg;codecs=opus");
  assert.equal(selected?.extension, "ogg");
  assert.deepEqual(checked, [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
  ]);
  assert.equal(
    audio.selectAudioRecordingFormat({ isTypeSupported: () => false }),
    null,
  );
});

test("recorded audio enforces 16 MiB and five minutes at exact boundaries", () => {
  assert.equal(
    audio.validateRecordedAudio({
      size: audio.MAX_AUDIO_RECORDING_BYTES,
      durationMs: audio.MAX_AUDIO_RECORDING_MS,
    }),
    null,
  );
  assert.match(
    audio.validateRecordedAudio({
      size: audio.MAX_AUDIO_RECORDING_BYTES + 1,
      durationMs: 1000,
    }),
    /16 MB/,
  );
  assert.match(
    audio.validateRecordedAudio({
      size: 10,
      durationMs: audio.MAX_AUDIO_RECORDING_MS + 1,
    }),
    /5 minutos/,
  );
  assert.match(
    audio.validateRecordedAudio({ size: 0, durationMs: 1000 }),
    /vazia/,
  );
  assert.equal(audio.formatRecordingDuration(0), "00:00");
  assert.equal(audio.formatRecordingDuration(65_999), "01:05");
});

test("microphone failures produce specific safe messages", () => {
  assert.match(
    audio.microphoneErrorMessage({ name: "NotAllowedError" }),
    /Permita o acesso/,
  );
  assert.match(
    audio.microphoneErrorMessage({ name: "NotFoundError" }),
    /Nenhum microfone/,
  );
  assert.match(
    audio.microphoneErrorMessage({ name: "NotReadableError" }),
    /ocupado/,
  );
  assert.match(
    audio.microphoneCapabilityMessage({
      secureContext: false,
      hasMediaDevices: false,
      hasMediaRecorder: false,
    }),
    /HTTPS|localhost/,
  );
  assert.match(
    audio.microphoneCapabilityMessage({
      secureContext: true,
      hasMediaDevices: true,
      hasMediaRecorder: false,
    }),
    /navegador não oferece/,
  );
});

test("recorder re-arms its mounted guard after the StrictMode verification cycle", () => {
  const source = fs.readFileSync(
    "components/whatsapp/audio-recorder.tsx",
    "utf8",
  );
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*\/\/ React Strict Mode[\s\S]*?mounted\.current = true;[\s\S]*?return \(\) => \{\s*mounted\.current = false;/,
  );
  assert.match(source, /"clique_recebido"/);
  assert.match(source, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(source, /recorder\.start\(1000\)/);
  assert.match(source, /changePhase\("recording"\)/);
});

function conversation(status, assignedUserId = null) {
  return {
    id: "conversation",
    attendanceStatus: status,
    assignedUserId,
  };
}
const owner = { id: "owner", isActive: true, isAdmin: false };
const other = { id: "other", isActive: true, isAdmin: false };
const admin = { id: "admin", isActive: true, isAdmin: true };

test("reply permission follows attendance and assignment instead of the selected tab", () => {
  assert.equal(
    attendance.canSendConversationMessage(
      owner,
      conversation("in_progress", owner.id),
    ),
    true,
  );
  assert.equal(
    attendance.canSendConversationMessage(
      other,
      conversation("in_progress", owner.id),
    ),
    false,
  );
  assert.equal(
    attendance.canSendConversationMessage(
      admin,
      conversation("in_progress", owner.id),
    ),
    true,
  );
  for (const status of ["waiting", "finished"])
    assert.equal(
      attendance.canSendConversationMessage(
        owner,
        conversation(status, owner.id),
      ),
      false,
    );
  assert.equal(
    attendance.canSendConversationMessage(
      { ...owner, isActive: false },
      conversation("in_progress", owner.id),
    ),
    false,
  );
});

test("claiming the selected waiting conversation moves the filter and keeps it selected", () => {
  const claimed = conversation("in_progress", owner.id);
  assert.equal(
    presentation.categoryAfterAttendanceUpdate("waiting", claimed.id, claimed),
    "in_progress",
  );
  assert.equal(
    presentation.categoryAfterAttendanceUpdate("waiting", "another", claimed),
    "waiting",
  );
  assert.equal(
    presentation.categoryAfterAttendanceUpdate("all", claimed.id, claimed),
    "all",
  );
});
