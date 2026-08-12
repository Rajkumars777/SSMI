import sqlite3
c = sqlite3.connect("ssmi_local.db")
m = c.execute("select id, status from meetings where id='meeting_88f81fae'").fetchone()
print("meeting:", m)
print("transcript:")
for r in c.execute("select text from transcript_segments where meeting_id='meeting_88f81fae' limit 3"):
    print(" ", r[0][:90])
