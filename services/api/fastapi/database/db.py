import os
from typing import AsyncGenerator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

DATABASE_URL_ENV = os.getenv("DATABASE_URL", "")
POSTGRES_URL = DATABASE_URL_ENV or "postgresql+asyncpg://ssmi_user:ssmi_password@localhost:5432/ssmi_db"
SQLITE_URL = "sqlite+aiosqlite:///./ssmi_local.db"

# Build engine with appropriate params depending on database type
def _make_engine(url: str):
    """Create async engine; applies PostgreSQL pool params only when using asyncpg."""
    is_pg = url.startswith("postgresql") or url.startswith("postgres")
    kwargs = dict(echo=False, future=True)
    if is_pg:
        kwargs.update(pool_pre_ping=True, pool_size=10, max_overflow=20)
    return create_async_engine(url, **kwargs)

# Engine: always start with SQLite immediately (safe default).
# init_db() will upgrade to PostgreSQL if available.
engine = _make_engine(SQLITE_URL)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency that yields async database session."""
    async with async_session_maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """Initialise database (PostgreSQL with pgvector if running, or local SQLite fallback)."""
    global engine, async_session_maker

    urls_to_try: list[tuple[str, str]] = []
    if DATABASE_URL_ENV:
        urls_to_try.append(("PostgreSQL", DATABASE_URL_ENV))
    elif POSTGRES_URL.startswith("postgresql"):
        urls_to_try.append(("PostgreSQL", POSTGRES_URL))
    urls_to_try.append(("SQLite", SQLITE_URL))

    last_error: Exception | None = None
    for label, url in urls_to_try:
        try:
            candidate = _make_engine(url)
            async with candidate.begin() as conn:
                if label == "PostgreSQL":
                    try:
                        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
                    except Exception as e:
                        print(f"[Warning] Could not enable pgvector extension: {e}")
                await conn.run_sync(Base.metadata.create_all)
                await _migrate_sqlite_columns(conn)

            engine = candidate
            async_session_maker = async_sessionmaker(
                engine,
                class_=AsyncSession,
                expire_on_commit=False,
                autocommit=False,
                autoflush=False,
            )
            print(f"[Database] {label} database initialized successfully!")
            return
        except Exception as e:
            last_error = e
            print(f"[Database] {label} connection failed ({e}).")

    raise RuntimeError(f"Could not initialize any database backend: {last_error}")


async def _migrate_sqlite_columns(conn):
    """Add columns to existing SQLite DBs that predate schema changes."""
    if conn.dialect.name != "sqlite":
        return
    result = await conn.execute(text("PRAGMA table_info(meetings)"))
    columns = {row[1] for row in result.fetchall()}
    if "processing_error" not in columns:
        await conn.execute(text("ALTER TABLE meetings ADD COLUMN processing_error TEXT"))
        print("[Database] Migrated: added meetings.processing_error column")

