"""
Database Engine & Session — SSMI
=================================
Sets up the SQLAlchemy async engine with automatic fallback:
  1. Tries PostgreSQL (with pgvector extension) if a DATABASE_URL is configured.
  2. Falls back to a local SQLite file (ssmi_local.db) for development.

Exports:
  - engine              : The active async engine instance.
  - async_session_maker : Factory for AsyncSession used in FastAPI dependencies.
  - Base                : Declarative base shared by all ORM models.
  - get_db()            : FastAPI dependency that yields a managed DB session.
  - init_db()           : Called at startup to create tables and run migrations.
"""

import os
from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

# ---------------------------------------------------------------------------
# Database URL configuration
# ---------------------------------------------------------------------------
# Prefer the DATABASE_URL environment variable (set in .env for production).
# If unset, try a default local PostgreSQL connection; SQLite is the final fallback.
DATABASE_URL_ENV = os.getenv("DATABASE_URL", "")
POSTGRES_URL     = DATABASE_URL_ENV or "postgresql+asyncpg://ssmi_user:ssmi_password@localhost:5432/ssmi_db"
SQLITE_URL       = "sqlite+aiosqlite:///./ssmi_local.db"


def _make_engine(url: str):
    """
    Create an async SQLAlchemy engine for the given URL.

    PostgreSQL-specific connection pool parameters are only applied when using
    asyncpg — they are not compatible with aiosqlite.
    """
    is_pg = url.startswith("postgresql") or url.startswith("postgres")
    kwargs = dict(echo=False, future=True)
    if is_pg:
        # Pool tuning for a modest production workload
        kwargs.update(pool_pre_ping=True, pool_size=10, max_overflow=20)
    return create_async_engine(url, **kwargs)


# Start with SQLite immediately so the app can serve requests even before
# init_db() upgrades to PostgreSQL at startup.
engine = _make_engine(SQLITE_URL)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,  # Keep ORM objects usable after commit
    autocommit=False,
    autoflush=False,
)

# Shared declarative base — imported by all model files
Base = declarative_base()


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Yield an async database session for use in FastAPI route handlers.

    Automatically rolls back on any uncaught exception, then closes the session.
    """
    async with async_session_maker() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


# ---------------------------------------------------------------------------
# Startup initialisation
# ---------------------------------------------------------------------------

async def init_db():
    """
    Initialise the database at application startup.

    Strategy:
      1. Try PostgreSQL (from DATABASE_URL env or default localhost).
      2. If that fails, fall back to local SQLite.
      3. Create all ORM tables (idempotent — safe to call on every restart).
      4. Run lightweight SQLite column migrations for schema additions.

    Raises RuntimeError if no database backend can be reached.
    """
    global engine, async_session_maker

    # Build the ordered list of backends to try
    urls_to_try: list[tuple[str, str]] = []
    if DATABASE_URL_ENV:
        urls_to_try.append(("PostgreSQL", DATABASE_URL_ENV))
    urls_to_try.append(("SQLite", SQLITE_URL))  # Default local database

    last_error: Exception | None = None
    for label, url in urls_to_try:
        try:
            candidate = _make_engine(url)
            async with candidate.begin() as conn:
                # Enable pgvector extension on PostgreSQL (ignored on SQLite)
                if label == "PostgreSQL":
                    try:
                        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector;"))
                    except Exception as e:
                        print(f"[Warning] Could not enable pgvector extension: {e}")

                # Create all tables defined in Base.metadata (safe if they already exist)
                await conn.run_sync(Base.metadata.create_all)

                # Apply any pending SQLite column migrations
                await _migrate_sqlite_columns(conn)

            # Promote the successful engine to the global singleton
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


# ---------------------------------------------------------------------------
# SQLite migration helpers
# ---------------------------------------------------------------------------

async def _migrate_sqlite_columns(conn):
    """
    Add columns to an existing SQLite database that predate schema additions.

    This avoids breaking local dev databases on schema updates — PostgreSQL
    handles schema changes via Alembic in production.
    """
    if conn.dialect.name != "sqlite":
        return  # Only needed for SQLite; PostgreSQL uses proper migrations

    # Inspect current columns in the meetings table
    result = await conn.execute(text("PRAGMA table_info(meetings)"))
    columns = {row[1] for row in result.fetchall()}

    # Add processing_error column if it doesn't exist yet
    if "processing_error" not in columns:
        await conn.execute(text("ALTER TABLE meetings ADD COLUMN processing_error TEXT"))
        print("[Database] Migrated: added meetings.processing_error column")
