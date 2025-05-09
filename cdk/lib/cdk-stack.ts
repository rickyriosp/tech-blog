import * as cdk from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface CloudTalentsBlogStackProps extends cdk.StackProps {
  blogUrl: string;
}

export class CloudTalentsBlogStack extends cdk.Stack {
  readonly githubProvider: iam.IOpenIdConnectProvider;

  constructor(scope: Construct, id: string, props: CloudTalentsBlogStackProps) {
    super(scope, id, props);

    // ----------------------------------------------------------------------
    // S3 Bucket
    // ----------------------------------------------------------------------
    const blogBucket = new s3.Bucket(this, 'BlogBucket', {
      bucketName: props.blogUrl,
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        blockPublicPolicy: true,
        ignorePublicAcls: true,
        restrictPublicBuckets: true,
      }),
      publicReadAccess: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: false,
      versioned: false,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // websiteIndexDocument: 'index.html',
      // websiteErrorDocument: '404.html',
    });

    new cdk.CfnOutput(this, 'BlogBucketOutput', {
      key: 'BlogBucketName',
      value: blogBucket.bucketName,
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

    // ----------------------------------------------------------------------
    // CloudFront S3 Origin
    // ----------------------------------------------------------------------
    // const s3OriginStatic = new origins.S3StaticWebsiteOrigin(blogBucket, {
    //   originId: `${props.blogUrl}.s3`,
    //   protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    //   httpPort: 80,
    //   originShieldEnabled: false,
    // });

    const s3OriginOAC = new cloudfront.S3OriginAccessControl(this, `S3OacOrigin`, {
      originAccessControlName: `${props.blogUrl}.s3`,
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(blogBucket, {
      originAccessControl: s3OriginOAC,
    });

    // ----------------------------------------------------------------------
    // CloudFront Function
    // ----------------------------------------------------------------------
    const cloudfrontFunction = new cloudfront.Function(this, 'CloudFrontFunction', {
      functionName: 'CloudFrontFunctionIndexHtml',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      autoPublish: true,
      code: cloudfront.FunctionCode.fromInline(`
          async function handler(event) {
            var request = event.request;
            var uri = request.uri;
            
            // Check whether the URI is missing a file name.
            if (uri.endsWith('/')) {
                request.uri += 'index.html';
            } 
            // Check whether the URI is missing a file extension.
            else if (!uri.includes('.')) {
                request.uri += '/index.html';
            }

            return request;
          }
        `),
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
        functionAssociations: [
          {
            function: cloudfrontFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
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
      value: blogDistribution.distributionId,
    });

    // ----------------------------------------------------------------------
    // OIDC Provider
    // ----------------------------------------------------------------------
    try {
      this.githubProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
        this,
        'GitHubOidcProvider',
        `arn:${this.partition}:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
      );
    } catch (error) {
      this.githubProvider = new iam.OpenIdConnectProvider(this, 'GitHubOidcProvider', {
        url: 'https://token.actions.githubusercontent.com',
        clientIds: ['sts.amazonaws.com'],
        thumbprints: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
      });
    }

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
      assumedBy: new iam.WebIdentityPrincipal(this.githubProvider.openIdConnectProviderArn, {
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
      value: githubRole.roleName,
    });
  }
}
