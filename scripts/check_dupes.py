import sqlite3
from collections import Counter

c = sqlite3.connect("ssmi_local.db")
text = "celebrity to endorse"
rows = c.execute(
    "select meeting_id, start_time, end_time, text from transcript_segments where text like ? order by start_time",
    (f"%{text}%",),
).fetchall()
print("matches:", len(rows))
for r in rows:
    print(r)

for (mid,) in c.execute("select distinct meeting_id from transcript_segments").fetchall():
    segs = c.execute(
        "select text, start_time, end_time from transcript_segments where meeting_id=? order by start_time",
        (mid,),
    ).fetchall()
    counts = Counter(segs)
    dupes = {k: v for k, v in counts.items() if v > 1}
    if dupes:
        print(f"\nmeeting {mid}:")
        for (text, st, et), n in dupes.items():
            print(f"  x{n} [{st}-{et}] {text[:70]}")
