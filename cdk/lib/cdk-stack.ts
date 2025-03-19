import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface CdkStackProps extends cdk.StackProps {
  blogUrl: string;
}

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: CdkStackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: props.blogUrl,
      blockPublicAccess: new s3.BlockPublicAccess({ blockPublicAcls: false }),
      publicReadAccess: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: '404.html',
    });

    bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'PublicGetReadObject',
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${props.blogUrl}/*`],
        principals: [new iam.ServicePrincipal('*')],
      }),
    );

    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: props.blogUrl,
      keyAlgorithm: acm.KeyAlgorithm.RSA_2048,
      validation: acm.CertificateValidation.fromDns(),
    });

    const s3Origin = new origins.S3StaticWebsiteOrigin(bucket, {
      originId: `${props.blogUrl}.s3`,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      originShieldEnabled: false,
    });

    const distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
      defaultBehavior: {
        origin: s3Origin,
        compress: true,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          ttl: cdk.Duration.seconds(10),
          responsePagePath: '/404.html',
        },
      ],
      domainNames: [props.blogUrl],
      enableLogging: false,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      certificate: certificate,
      logIncludesCookies: false,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      sslSupportMethod: cloudfront.SSLMethod.SNI,
    });
  }
}
