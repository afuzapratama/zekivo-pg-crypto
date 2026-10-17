import ProjectDetail from "../detail";
export const dynamic = "force-dynamic";
export default function Page(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before_key?: string }>;
}) {
  return <ProjectDetail {...props} section="api-keys" />;
}
