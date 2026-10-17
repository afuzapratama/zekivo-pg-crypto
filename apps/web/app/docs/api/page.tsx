import { Badge } from "@/components/ui/badge";
import styles from "../docs.module.css";
import Reference from "../reference";
export default function ApiPage() {
  return (
    <div className={styles.apiPage}>
      <Badge
        variant="outline"
        className="bg-white py-1.5 text-[10px] tracking-wider"
      >
        OPENAPI · LIVE CONTRACT
      </Badge>
      <h1>API reference</h1>
      <p>
        Endpoint, schema, autentikasi, dan contoh request dari gateway yang
        sedang berjalan. Coba integrasi langsung melalui Scalar.
      </p>
      <Reference />
    </div>
  );
}
