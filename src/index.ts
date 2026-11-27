export type Env = {
	TENANTS: AiSearchNamespace;
};

function tenantInstanceId(tenantId: string): string | null {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tenantId)) {
		return null;
	}

	const instanceId = `tenant-${tenantId}`;
	return instanceId.length <= 32 ? instanceId : null;
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		// Identify the tenant from the request header.
		const tenantId = request.headers.get("x-tenant-id");

		if (!tenantId) {
			return new Response("Missing x-tenant-id header", { status: 400 });
		}

		const normalizedTenantId = tenantId.trim().toLowerCase();
		const instanceId = tenantInstanceId(normalizedTenantId);

		if (!instanceId) {
			return new Response(
				"x-tenant-id must contain only lowercase letters, numbers, and hyphens and fit in an AI Search instance ID",
				{ status: 400 },
			);
		}

		// Create a new instance for the tenant.
		if (url.pathname === "/onboard" && request.method === "POST") {
			const instance = await env.TENANTS.create({
				id: instanceId,
				type: "r2",
				source: "my-bucket",
				source_params: {
					include_items: [`customers/${normalizedTenantId}/**`],
				},
			});
			return Response.json({ success: true, instance: await instance.info() });
		}

		// Upload a document to the tenant's instance.
		if (url.pathname === "/upload" && request.method === "POST") {
			const formData = await request.formData();
			const file = formData.get("file") as File;

			const item = await env.TENANTS.get(instanceId).items.upload(
				file.name,
				await file.arrayBuffer(),
			);
			return Response.json({ success: true, item });
		}

		// Search the tenant's instance. Search is isolated to their instance.
		if (url.pathname === "/search") {
			const query = url.searchParams.get("q") || "";

			const results = await env.TENANTS.get(instanceId).search({
				messages: [{ role: "user", content: query }],
				ai_search_options: {
					retrieval: {
						filters: {
							folder: {
								$gte: `customers/${normalizedTenantId}/`,
								$lt: `customers/${normalizedTenantId}0`,
							},
						},
					},
				},
			});
			return Response.json(results);
		}

		// Delete the tenant's instance and all its data.
		if (url.pathname === "/offboard" && request.method === "DELETE") {
			await env.TENANTS.delete(instanceId);
			return Response.json({ success: true });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;