# Changelog

## [0.2.0](https://github.com/kuon-bui/tool-9router/compare/v0.1.0...v0.2.0) (2026-10-09)


### Features

* 9router upstream client with timeout and typed results ([85ed7fa](https://github.com/kuon-bui/tool-9router/commit/85ed7faa7e15498d96398fc40b83d575ed15726c))
* accept Authorization Bearer alongside x-api-key ([586ee1f](https://github.com/kuon-bui/tool-9router/commit/586ee1f1d28bac4303a7556ecd6463ee82867afb))
* add Markdown formatter for MCP quota results ([252ad0f](https://github.com/kuon-bui/tool-9router/commit/252ad0faa5ac21528dfa66853107eaca4af8442d))
* add MCP tool schemas and handlers over quotaService ([b476841](https://github.com/kuon-bui/tool-9router/commit/b4768419114cd1e4291d7c68bafabb4c82737ec0))
* background poller sweeping all connections through the queue ([164f8bf](https://github.com/kuon-bui/tool-9router/commit/164f8bf83ff37dbaacfe8b992860a623e2472805))
* derive 9router cli token once at boot and keep it in memory ([77ac867](https://github.com/kuon-bui/tool-9router/commit/77ac867cc4c1f1810b5734f9caa7c7ffb2eafbaa))
* elysia http surface with api-key guard, filters and refresh cooldown ([9d7061a](https://github.com/kuon-bui/tool-9router/commit/9d7061a2ea9473b17eec286d2abcb4762413a7ac))
* implement router API key support with caching mechanism ([88250fa](https://github.com/kuon-bui/tool-9router/commit/88250fa96c32db2da2cbf170176716e52b3bb92d))
* in-memory snapshot store with last-good retention and staleness ([aa96d08](https://github.com/kuon-bui/tool-9router/commit/aa96d08fc9cccac4ff6cd771c9d7180c39c256ce))
* load and validate configuration from environment ([181b320](https://github.com/kuon-bui/tool-9router/commit/181b3205c85bf9a5f7e884995469c3e4bbed1705))
* normalize 9router usage responses into a stable shape ([ec0b7d2](https://github.com/kuon-bui/tool-9router/commit/ec0b7d26f5bdf8d1950881929111d07634a1d23d))
* reconnect to 9router on failure ([#1](https://github.com/kuon-bui/tool-9router/issues/1)) ([a079cbf](https://github.com/kuon-bui/tool-9router/commit/a079cbf797eb844b1098db5ac5b412dba7d2c20f))
* single-worker priority queue with inter-job delay and dedup ([e948a16](https://github.com/kuon-bui/tool-9router/commit/e948a168352027cb1a734bbecf3b31b295f54f49))
* wire server together with graceful shutdown and operator docs ([2bcc5a9](https://github.com/kuon-bui/tool-9router/commit/2bcc5a959bbba4ab28f13b8540a6727dc70a8ec0))
* wire the MCP Streamable HTTP endpoint into the Elysia server ([9dff829](https://github.com/kuon-bui/tool-9router/commit/9dff8290d5af1115db5f78eaf73bc7c5aee6aac2))


### Documentation

* add design spec and implementation plan for the quota server ([816ea55](https://github.com/kuon-bui/tool-9router/commit/816ea556a24b2e60941d5c7b2dc71c27e6607f84))
* add design spec for the MCP quota surface ([81e223e](https://github.com/kuon-bui/tool-9router/commit/81e223ece36618e6090843cf9517afa47cc66ca7))
* add implementation plan for the MCP quota surface ([c62bc2d](https://github.com/kuon-bui/tool-9router/commit/c62bc2d8dc71838296880b4045677e41eb068bad))
* document the MCP surface in README ([f1d747e](https://github.com/kuon-bui/tool-9router/commit/f1d747ed2d7875f1e3a09ad13f755924f6ea1ba5))
* mark implementation plan complete ([654c60f](https://github.com/kuon-bui/tool-9router/commit/654c60f5eba23141d7762a57a6c548e6a0477495))
* unify the repo on zod as the single schema system ([efb9057](https://github.com/kuon-bui/tool-9router/commit/efb9057ce93ae0d1ca20b9b871d93d377162c398))
