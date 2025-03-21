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

    // ----------------------------------------------------------------------
    // S3 Bucket
    // ----------------------------------------------------------------------
    const blogBucket = new s3.Bucket(this, 'BlogBucket', {
      bucketName: props.blogUrl,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: false,
      versioned: false,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: '404.html',
    });

    new cdk.CfnOutput(this, 'BlogBucketOutput', {
      key: 'BlogBucketName',
      value: blogBucket.bucketName
    });

    // blogBucket.addToResourcePolicy(
    //   new iam.PolicyStatement({
    //     sid: 'PublicGetReadObject',
    //     effect: iam.Effect.ALLOW,
    //     actions: ['s3:GetObject'],
    //     resources: [`arn:aws:s3:::${props.blogUrl}/*`],
    //     principals: [new iam.StarPrincipal()],
    //   }),
    // );

    // ----------------------------------------------------------------------
    // ACM Certificate
    // ----------------------------------------------------------------------
    const blogCertificate = new acm.Certificate(this, 'BlogCertificate', {
      domainName: props.blogUrl,
      keyAlgorithm: acm.KeyAlgorithm.RSA_2048,
      validation: acm.CertificateValidation.fromDns(),
    });

    const s3Origin = new origins.S3StaticWebsiteOrigin(blogBucket, {
      originId: `${props.blogUrl}.s3`,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      originShieldEnabled: false,
    });

    // ----------------------------------------------------------------------
    // CloudFront Distribution
    // ----------------------------------------------------------------------
    const blogDistribution = new cloudfront.Distribution(this, 'BlogDistribution', {
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
      certificate: blogCertificate,
      logIncludesCookies: false,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      sslSupportMethod: cloudfront.SSLMethod.SNI,
    });

    new cdk.CfnOutput(this, 'BlogDistributionOutput', {
      key: 'BlogDistributionId',
      value: blogDistribution.distributionId
    });

    // ----------------------------------------------------------------------
    // OIDC Provider
    // ----------------------------------------------------------------------
    const githubProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
      thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
    });

    // ----------------------------------------------------------------------
    // IAM Policy
    // ----------------------------------------------------------------------
    const policyDocument = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          sid: 'GitHubActionsS3',
          effect: iam.Effect.ALLOW,
          actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket'],
          resources: [`arn:aws:s3:::${props.blogUrl}`, `arn:aws:s3:::${props.blogUrl}/*`],
        }),
        new iam.PolicyStatement({
          sid: 'GitHubActionsCFD',
          effect: iam.Effect.ALLOW,
          actions: ['cloudfront:CreateInvalidation'],
          resources: [
            `arn:aws:cloudfront::${this.account}:distribution/${blogDistribution.distributionId}`,
          ],
        }),
      ],
    });

    const githubPolicy = new iam.ManagedPolicy(this, 'GitHubS3Policy', {
      managedPolicyName: 'GitHubS3Policy',
      description:
        'Allow read-write access to the tech-blog S3 bucket, and to invalidate CloudFront cache',
      document: policyDocument,
    });

    // ----------------------------------------------------------------------
    // IAM Role
    // ----------------------------------------------------------------------
    const githubRole = new iam.Role(this, 'GitHubS3Role', {
      roleName: 'GitHubS3Role',
      description: 'Role used by GitHub Actions to push new content to blog S3 Bucket',
      maxSessionDuration: cdk.Duration.hours(2),
      managedPolicies: [githubPolicy],
      assumedBy: new iam.WebIdentityPrincipal(githubProvider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': ['sts.amazonaws.com'],
        },
        StringLike: {
          'token.actions.githubusercontent.com:sub': ['repo:rickyriosp/tech-blog:*'],
        },
      }),
    });

    new cdk.CfnOutput(this, 'GitHubS3RoleOutput', {
      key: 'GitHubS3RoleName',
      value: githubRole.roleName
    });
  }
}
