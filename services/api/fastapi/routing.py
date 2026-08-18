"""
Custom APIRoute — SSMI
=======================
Provides CamelCaseAPIRoute, a thin subclass of FastAPI's APIRoute that forces
response models to serialize using their Python field names rather than ORM
column aliases.

This ensures that the React frontend consistently receives camelCase JSON keys
(e.g. `customerName`, `startTime`) regardless of how the Pydantic models
define their aliases.
"""

from fastapi.routing import APIRoute


class CamelCaseAPIRoute(APIRoute):
    """
    APIRoute subclass that enforces `response_model_by_alias=False`.

    By default FastAPI serialises Pydantic models using alias names, which
    can produce snake_case keys from ORM-mapped aliases. Setting
    `response_model_by_alias=False` ensures the frontend always receives the
    field names declared on each schema class (which are camelCase in this
    project).
    """

    def __init__(self, *args, **kwargs):
        # Force alias-free serialization on every route using this class
        kwargs["response_model_by_alias"] = False
        super().__init__(*args, **kwargs)
