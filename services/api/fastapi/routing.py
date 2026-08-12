from fastapi.routing import APIRoute


class CamelCaseAPIRoute(APIRoute):
    """Serialize Pydantic response models using field names (camelCase), not ORM aliases."""

    def __init__(self, *args, **kwargs):
        kwargs["response_model_by_alias"] = False
        super().__init__(*args, **kwargs)
