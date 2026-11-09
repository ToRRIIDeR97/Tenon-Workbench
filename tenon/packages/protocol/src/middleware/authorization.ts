import { HttpApiMiddleware } from "effect/http-api"
import { UnauthorizedError } from "../errors"

export class Authorization extends HttpApiMiddleware.Service<Authorization>()("@tenon/HttpApiAuthorization", {
  error: UnauthorizedError,
}) {}
