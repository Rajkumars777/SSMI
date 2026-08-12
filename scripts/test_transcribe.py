from services.transcription.stt import transcribe_audio

path = r"storage/audio/meeting_88f81fae_Business English Conversation Marketing Meeting ESL - Learn English by Pocket Passport (128k).mp3"
segs = transcribe_audio(path, "base", "en")
print("SEGMENTS:", len(segs))
for s in segs[:8]:
    print(f"[{s['start_time']:.1f}s] {s['text'][:150]}")
