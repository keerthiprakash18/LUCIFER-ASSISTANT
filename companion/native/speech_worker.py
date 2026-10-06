"""Offline command transcription worker. Audio paths arrive over stdin, never a cloud API."""
import json
import os
import sys
import re

root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
# The Windows venv launcher has a separate child process. Lock in the actual
# interpreter before loading the model, so crash recovery cannot load two copies.
import msvcrt
lock = open(os.path.join(root, ".local", "native", "transcription.lock"), "a+b")
lock.seek(0)
try:
    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
except OSError:
    sys.exit("Local transcription is already owned by another runtime.")
from faster_whisper import WhisperModel
model_path = os.path.join(root, ".local", "native", "models", "whisper-small")
model = WhisperModel(model_path, device="cpu", compute_type="int8", cpu_threads=4, local_files_only=True)
print(json.dumps({"kind": "ready", "model": "faster-whisper-small", "offline": True}), flush=True)
for line in sys.stdin:
    filename = None
    try:
        job = json.loads(line)
        candidate = os.path.realpath(job["path"])
        audio_root = os.path.realpath(os.path.join(root, ".local", "native", "audio"))
        if os.path.commonpath([os.path.normcase(candidate), os.path.normcase(audio_root)]) != os.path.normcase(audio_root):
            raise ValueError("Audio path outside the native command directory")
        filename = candidate
        language = job.get("language", "auto")
        segments, info = model.transcribe(filename, language=None if language == "auto" else language,
            beam_size=1, vad_filter=True, vad_parameters={"min_silence_duration_ms": 200}, condition_on_previous_text=False,
            initial_prompt="Wake words: Lucifer, Hey Lucifer, Lucyfer, லூசிபர், லூசிஃபர். English and Tamil commands. Notepad, VS Code, Chrome, notes, reminders.")
        segments = list(segments)
        text = " ".join(segment.text.strip() for segment in segments).strip()
        wake_mode = job.get("mode") == "wake"
        if not segments:
            text = ""
        elif wake_mode:
            # A one-word wake utterance is easy for Whisper to score lower than a
            # full command. Keep the local transcript unless every segment is
            # extremely speech-like-noise; the wake matcher below is still strict.
            if all(segment.no_speech_prob > 0.93 and segment.avg_logprob < -1.5 for segment in segments):
                text = ""
        elif all(segment.no_speech_prob > 0.8 or segment.avg_logprob < -1.2 for segment in segments):
            text = ""

        exact_wake = re.compile(
            r"(?:\b(?:hey\s+)?(?:lucifer|lucyfer|lusifer|lousifer|loosefer|loocifer)\b|"
            r"லூசிபர்|லூசிஃபர்|லூசிஃபெர்)[\s,.:;!?…-]*",
            re.IGNORECASE,
        )

        def edit_distance(a, b):
            previous = list(range(len(b) + 1))
            for i, ca in enumerate(a, 1):
                current = [i]
                for j, cb in enumerate(b, 1):
                    current.append(min(current[-1] + 1, previous[j] + 1, previous[j - 1] + (ca != cb)))
                previous = current
            return previous[-1]

        def wake_marker(value):
            direct = exact_wake.search(value)
            if direct and len(re.sub(r"[^a-z]", "", value[:direct.start()].lower())) <= 3:
                return direct
            # Whisper may render the name phonetically. Only inspect the first
            # two lexical tokens so ambient conversation cannot trigger it later.
            for match in list(re.finditer(r"[A-Za-z]+", value))[:3]:
                token = match.group(0).lower()
                if token == "hey":
                    continue
                if 5 <= len(token) <= 9 and edit_distance(token, "lucifer") <= 2:
                    class FuzzyMatch:
                        def __init__(self, start, end):
                            self._start, self._end = start, end
                        def start(self):
                            return self._start
                        def end(self):
                            return self._end
                    end = match.end()
                    trailing = re.match(r"[\s,.:;!?…-]*", value[end:])
                    if trailing:
                        end += trailing.end()
                    return FuzzyMatch(match.start(), end)
            return None

        marker = wake_marker(text)
        if wake_mode:
            # Ambient transcripts never leave this local worker. Only text after
            # a locally detected wake marker may enter the action pipeline.
            print(json.dumps({"kind": "wake", "id": job["id"], "wake": bool(marker),
                              "text": text[marker.end():].strip() if marker else "",
                              "heard": text[:120]}, ensure_ascii=False), flush=True)
            continue
        print(json.dumps({"kind": "transcript", "id": job["id"], "text": text,
                          "wake": bool(marker), "language": info.language, "segments": len(segments)}, ensure_ascii=False), flush=True)
    except Exception as error:
        print(json.dumps({"kind": "error", "errorType": type(error).__name__, "error": "Local transcription failed. Check microphone audio and the installed model."}), flush=True)
    finally:
        try:
            if filename is not None:
                os.remove(filename)
        except OSError:
            pass
