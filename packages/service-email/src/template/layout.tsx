import {
  Body,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import type { JSX, ReactNode } from "react";

export function BaseLayout<TStyles extends EmailBaseStyles>(props: {
  readonly children: (styles: TStyles) => ReactNode;
  readonly previewText: string;
  readonly enhanceStyles?: (styles: EmailBaseStyles) => TStyles;
  readonly project: {
    readonly name: ReactNode;
    readonly logo?: ReactNode;
    readonly baseUri: string;
  };
  readonly notice?: (styles: TStyles) => ReactNode;
  readonly notificationSettings?: (styles: TStyles) => ReactNode;
}): JSX.Element {
  const styles = props.enhanceStyles?.(baseStyles) ?? (baseStyles as TStyles);

  return (
    <Html>
      <Head />
      <Body style={styles.main}>
        <Preview>{props.previewText}</Preview>
        <Container style={styles.container}>
          <Section style={styles.coverSection}>
            <Section style={styles.imageSection}>
              <Row>
                <Column>
                  <Text
                    style={{
                      color: "#fff",
                      fontFamily:
                        "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
                      fontSize: "28px",
                      margin: "24px 0",
                      fontWeight: "bold",
                      textAlign: "center",
                      lineHeight: "1.3em",
                    }}
                  >
                    {props.project.logo ?? props.project.name}
                  </Text>
                </Column>
              </Row>
            </Section>
            <Section style={styles.upperSection}>
              {props.children(styles)}
            </Section>
            <Hr />
            {props.notice?.(styles) ?? (
              <Section style={styles.lowerSection}>
                <Text style={styles.cautionText}>
                  <strong>{props.project.name}</strong> service will never email
                  you and ask you to disclose or verify your password, credit
                  card, or banking account number.
                </Text>
              </Section>
            )}
          </Section>
          {props.notificationSettings?.(styles) ?? (
            <Text style={styles.footerText}>
              You have received this message because you are using{" "}
              <strong>{props.project.name}</strong> service. If you don't want
              to receive these emails please{" "}
              <Link
                href={`${props.project.baseUri}/app/settings`}
                target="_blank"
                style={styles.link}
              >
                manage your notification setting
              </Link>
              .
            </Text>
          )}
        </Container>
      </Body>
    </Html>
  );
}

const text = {
  color: "#333",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
  fontSize: "14px",
  margin: "24px 0",
};

const baseStyles = {
  h1: {
    color: "#333",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    fontSize: "20px",
    fontWeight: "bold",
    marginBottom: "15px",
  },
  link: {
    color: "#2754C5",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    fontSize: "14px",
    textDecoration: "underline",
  },
  text: text,
  mainText: {
    color: "#333",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    fontSize: "14px",
    margin: "24px 0",
    marginBottom: "14px",
  } as const,
  main: {
    backgroundColor: "#fff",
    color: "#212121",
  },
  container: {
    padding: "20px",
    margin: "0 auto",
    backgroundColor: "#eee",
  },
  imageSection: {
    backgroundColor: "#252f3d",
    padding: "20px 0",
  },
  coverSection: { backgroundColor: "#fff" },
  upperSection: { padding: "25px 35px" },
  lowerSection: { padding: "25px 35px" },
  footerText: {
    color: "#333",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    fontSize: "12px",
    margin: "24px 0",
    padding: "0 20px",
  } as const,
  cautionText: {
    color: "#333",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
    fontSize: "14px",
    margin: "0px",
  } as const,
  button: {
    fontSize: "14px",
    backgroundColor: "#1976d2",
    color: "#fff",
    lineHeight: 1.5,
    borderRadius: "0.5em",
    padding: "12px 24px",
    fontFamily: "Roboto,Arial,sans-serif",
    margin: "30px auto",
  },
} as const;

export type EmailBaseStyles = typeof baseStyles;
